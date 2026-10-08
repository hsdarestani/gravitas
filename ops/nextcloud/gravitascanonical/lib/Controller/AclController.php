<?php
declare(strict_types=1);
namespace OCA\GravitasCanonical\Controller;

use OCP\AppFramework\OCSController;
use OCP\AppFramework\Http\DataResponse;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\IRequest;
use OCP\IUserSession;
use OCP\IConfig;
use OCP\IDBConnection;
use OCP\Files\IRootFolder;
use OCA\GroupFolders\Mount\GroupMountPoint;
use OCA\GroupFolders\Folder\FolderManager;
use OCA\GroupFolders\ACL\Rule;
use OCA\GroupFolders\ACL\ACLManagerFactory;
use OCA\GroupFolders\ACL\RuleManager;
use OCA\GroupFolders\ACL\UserMapping\UserMappingManager;

/** Admin middleware remains enabled; the configured existing service is also required. */
class AclController extends OCSController {
    public function __construct(IRequest $request, private IUserSession $users,
        private IConfig $config, private IDBConnection $db, private IRootFolder $root) {
        parent::__construct('gravitascanonical', $request);
    }

    private function normalized(array $rules): array {
        if (count($rules) > 500) {
            throw new \InvalidArgumentException('Too many ACL rules');
        }
        $result = [];
        $seen = [];
        foreach ($rules as $rule) {
            if (!is_array($rule) || !in_array($rule['type'] ?? null, ['user', 'group'], true)
                || !is_string($rule['id'] ?? null) || $rule['id'] === ''
                || !is_int($rule['mask'] ?? null) || !is_int($rule['permissions'] ?? null)
                || $rule['mask'] < 0 || $rule['mask'] > 31
                || $rule['permissions'] < 0 || $rule['permissions'] > 31
                || ($rule['permissions'] & $rule['mask']) !== $rule['permissions']) {
                throw new \InvalidArgumentException('Invalid ACL rule');
            }
            $key = $rule['type'] . ':' . $rule['id'];
            if (isset($seen[$key])) {
                throw new \InvalidArgumentException('Duplicate ACL mapping');
            }
            $seen[$key] = true;
            $result[] = ['type' => $rule['type'], 'id' => $rule['id'],
                'mask' => $rule['mask'], 'permissions' => $rule['permissions']];
        }
        usort($result, fn ($a, $b) => [$a['type'], $a['id'], $a['mask'], $a['permissions']]
            <=> [$b['type'], $b['id'], $b['mask'], $b['permissions']]);
        return $result;
    }

    private function snapshot(array $rules): array {
        return $this->normalized(array_map(fn (Rule $rule) => [
            'type' => $rule->getUserMapping()->getType(), 'id' => $rule->getUserMapping()->getId(),
            'mask' => $rule->getMask(), 'permissions' => $rule->getPermissions(),
        ], $rules));
    }

    #[NoCSRFRequired]
    public function update(string $path, string $expected_etag, string $expected_rules, string $rules): DataResponse {
        $user = $this->users->getUser();
        $service = $this->config->getAppValue('gravitascanonical', 'service_user', '');
        if (!$user || $service === '' || $user->getUID() !== $service
            || strtolower($this->request->getHeader('OCS-APIRequest')) !== 'true') {
            return new DataResponse(['error' => 'service_identity_required'], 403);
        }
        $parts = explode('/', $path);
        if (!preg_match('/^GRV-[0-9]{6,}$/D', $parts[0]) || count($parts) > 100
            || str_contains($path, "\0") || str_contains($path, '\\')
            || array_intersect($parts, ['', '.', '..'])) {
            return new DataResponse(['error' => 'invalid_project_path'], 400);
        }
        if ($this->config->getSystemValueString('dbtype') !== 'pgsql') {
            return new DataResponse(['error' => 'native_transaction_backend_unsupported'], 503);
        }
        try {
            $expected = $this->normalized(json_decode($expected_rules, true, 32, JSON_THROW_ON_ERROR));
            $desired = $this->normalized(json_decode($rules, true, 32, JSON_THROW_ON_ERROR));
            $node = $this->root->getUserFolder($user->getUID())->get($path);
            $info = $node->getFileInfo();
            $mount = $info->getMountPoint();
            if (!$mount instanceof GroupMountPoint) {
                return new DataResponse(['error' => 'team_folder_required'], 403);
            }
            $folders = \OC::$server->get(FolderManager::class);
            if (!$folders->getFolderAclEnabled($mount->getFolderId())
                || !$folders->canManageACL($mount->getFolderId(), $user)) {
                return new DataResponse(['error' => 'acl_manager_required'], 403);
            }
            $manager = \OC::$server->get(RuleManager::class);
            $mappings = \OC::$server->get(UserMappingManager::class);
            $nativePath = trim($mount->getSourcePath() . '/' . $info->getInternalPath(), '/');
            $storage = $mount->getNumericStorageId();
            $fileId = $info->getId();
            if (!$fileId) {
                throw new \RuntimeException('Native file identity unavailable');
            }
            $prefix = $this->config->getSystemValueString('dbtableprefix', 'oc_');
            if (!preg_match('/^[a-zA-Z0-9_]+$/D', $prefix)) {
                throw new \RuntimeException('Invalid native table prefix');
            }
            $this->db->beginTransaction();
            try {
                // Blocks all ACL INSERT/UPDATE/DELETE, including native UI and
                // other clients; empty ACLs are protected against phantom rows.
                $this->db->executeStatement('LOCK TABLE "' . $prefix . 'group_folders_acl" IN SHARE ROW EXCLUSIVE MODE');
                $current = $manager->getAllRulesForPaths($storage, [$nativePath])[$nativePath] ?? [];
                $etag = '"' . $node->getEtag() . '"';
                if ($etag !== $expected_etag || $this->snapshot($current) !== $expected) {
                    $this->db->rollBack();
                    return new DataResponse(['error' => 'acl_revision_conflict'], 409);
                }
                $prepared = [];
                foreach ($desired as $row) {
                    $mapping = $mappings->mappingFromId($row['type'], $row['id']);
                    if (!$mapping) {
                        throw new \InvalidArgumentException('Unknown ACL mapping');
                    }
                    $prepared[] = new Rule($mapping, $fileId, $row['mask'], $row['permissions']);
                }
                $acl = \OC::$server->get(ACLManagerFactory::class)->getACLManager($user);
                if (!($acl->testACLPermissionsForPath($mount->getFolderId(), $storage, $nativePath, $prepared) & 1)) {
                    throw new \InvalidArgumentException('Service read access must remain');
                }
                foreach ($current as $rule) {
                    $manager->deleteRule($rule);
                }
                foreach ($prepared as $rule) {
                    $manager->saveRule($rule);
                }
                $saved = $manager->getAllRulesForPaths($storage, [$nativePath])[$nativePath] ?? [];
                if ($this->snapshot($saved) !== $desired) {
                    throw new \RuntimeException('Native ACL readback differs');
                }
                $node->getStorage()->getPropagator()->propagateChange($info->getInternalPath(), $info->getMtime());
                $this->db->commit();
                return new DataResponse(['applied' => true]);
            } catch (\Throwable $error) {
                $this->db->rollBack();
                throw $error;
            }
        } catch (\InvalidArgumentException | \JsonException | \TypeError $error) {
            return new DataResponse(['error' => 'invalid_acl_request'], 400);
        }
    }
}
