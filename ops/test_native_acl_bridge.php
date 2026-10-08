<?php
declare(strict_types=1);
namespace OCP { interface IRequest {} interface IUserSession {} interface IConfig {} interface IDBConnection {} }
namespace OCP\Files { interface IRootFolder {} }
namespace OCP\AppFramework { class OCSController { public function __construct($app, protected \OCP\IRequest $request) {} } }
namespace OCP\AppFramework\Http { class DataResponse { public function __construct(public $data, public $status = 200) {} } }
namespace OCA\GroupFolders\Mount {
    class GroupMountPoint {
        public function getFolderId() { return 208; }
        public function getSourcePath() { return '__groupfolders/208'; }
        public function getNumericStorageId() { return 9; }
    }
}
namespace OCA\GroupFolders\Folder {
    class FolderManager {
        public function getFolderAclEnabled($id) { return true; }
        public function canManageACL($id, $user) { return \Fixture::$manager; }
    }
}
namespace OCA\GroupFolders\ACL\UserMapping {
    class Mapping {
        public function __construct(private $type, private $id) {}
        public function getType() { return $this->type; }
        public function getId() { return $this->id; }
    }
    class UserMappingManager {
        public function mappingFromId($type, $id) {
            return $id === 'unknown' ? null : new Mapping($type, $id);
        }
    }
}
namespace OCA\GroupFolders\ACL {
    class Rule {
        public function __construct(private $mapping, private $fileId, private $mask, private $permissions) {}
        public function getUserMapping() { return $this->mapping; }
        public function getMask() { return $this->mask; }
        public function getPermissions() { return $this->permissions; }
    }
    class RuleManager {
        public function getAllRulesForPaths($storage, $paths) {
            if (!\Fixture::$locked) { throw new \RuntimeException('ACL read outside native lock'); }
            return [$paths[0] => \Fixture::$badReadback && \Fixture::$written ? [] : \Fixture::$rules];
        }
        public function deleteRule($rule) { \Fixture::$rules = array_values(array_filter(\Fixture::$rules, fn ($r) => $r !== $rule)); }
        public function saveRule($rule) {
            if (!\Fixture::$locked) { throw new \RuntimeException('ACL write outside native lock'); }
            \Fixture::$written = true; \Fixture::$rules[] = $rule;
        }
    }
    class ACLManagerFactory {
        public function getACLManager($user) { return $this; }
        public function testACLPermissionsForPath($folder, $storage, $path, $rules) { return \Fixture::$readable ? 1 : 0; }
    }
}
namespace {
    class Fixture {
        public static array $rules = [];
        public static bool $locked = false, $manager = true, $written = false, $badReadback = false, $readable = true;
        public static string $etag = 'v1', $provider = 'pgsql', $uid = 'service', $header = 'true';
        public static array $events = [];
        public static function reset() {
            self::$rules = []; self::$locked = self::$written = self::$badReadback = false;
            self::$manager = self::$readable = true; self::$etag = 'v1'; self::$provider = 'pgsql';
            self::$uid = 'service'; self::$header = 'true'; self::$events = [];
        }
    }
    class Container { public function get($class) { return new $class(); } }
    class OC { public static $server; }
    class Request implements \OCP\IRequest { public function getHeader($name) { return Fixture::$header; } }
    class Users implements \OCP\IUserSession {
        public function getUser() { return new class { public function getUID() { return Fixture::$uid; } }; }
    }
    class Config implements \OCP\IConfig {
        public function getAppValue($app, $key, $default) { return 'service'; }
        public function getSystemValueString($key, $default = '') { return $key === 'dbtype' ? Fixture::$provider : 'oc_'; }
    }
    class DB implements \OCP\IDBConnection {
        private array $saved;
        public function beginTransaction() { $this->saved = Fixture::$rules; Fixture::$events[] = 'begin'; }
        public function executeStatement($sql) {
            if ($sql !== 'LOCK TABLE "oc_group_folders_acl" IN SHARE ROW EXCLUSIVE MODE') {
                throw new \RuntimeException('Unexpected native lock SQL');
            }
            Fixture::$locked = true; Fixture::$events[] = 'lock';
        }
        public function commit() { Fixture::$locked = false; Fixture::$events[] = 'commit'; }
        public function rollBack() { Fixture::$rules = $this->saved; Fixture::$locked = false; Fixture::$events[] = 'rollback'; }
    }
    class NativeNode {
        public function get($path) { return $this; }
        public function getFileInfo() { return $this; }
        public function getMountPoint() { return new \OCA\GroupFolders\Mount\GroupMountPoint(); }
        public function getInternalPath() { return ''; }
        public function getId() { return 42; }
        public function getEtag() { return Fixture::$etag; }
        public function getMtime() { return 1; }
        public function getStorage() { return $this; }
        public function getPropagator() { return $this; }
        public function propagateChange($path, $mtime) { Fixture::$events[] = 'propagate'; }
    }
    class Root implements \OCP\Files\IRootFolder { public function getUserFolder($uid) { return new NativeNode(); } }
    OC::$server = new Container();
    require __DIR__ . '/nextcloud/gravitascanonical/lib/Controller/AclController.php';
    function callAcl(array $expected = [], string $etag = '"v1"', ?array $desired = null, string $path = 'GRV-000208') {
        $controller = new \OCA\GravitasCanonical\Controller\AclController(new Request(), new Users(), new Config(), new DB(), new Root());
        $desired ??= [['type' => 'user', 'id' => 'service', 'mask' => 31, 'permissions' => 31]];
        return $controller->update($path, $etag, json_encode($expected), json_encode($desired));
    }
    function check(bool $value, string $why) { if (!$value) { throw new \RuntimeException($why); } }
    Fixture::reset();
    check(callAcl()->status === 200, 'witnessed empty ACL should accept');
    check(Fixture::$events === ['begin', 'lock', 'propagate', 'commit'] && count(Fixture::$rules) === 1, 'atomic native write ordering');
    $existing = Fixture::$rules;
    Fixture::$events = [];
    check(callAcl()->status === 409 && Fixture::$rules === $existing, 'same ETag with externally inserted rule must conflict');
    Fixture::reset();
    check(callAcl([], '"stale"')->status === 409 && !Fixture::$written, 'stale ETag cannot write');
    Fixture::reset(); Fixture::$uid = 'other-admin';
    check(callAcl()->status === 403 && Fixture::$events === [], 'other admin cannot use service bridge');
    Fixture::reset(); Fixture::$header = '';
    check(callAcl()->status === 403 && Fixture::$events === [], 'cross-site simple request cannot use service bridge');
    Fixture::reset(); Fixture::$manager = false;
    check(callAcl()->status === 403 && Fixture::$events === [], 'native manager entitlement required');
    Fixture::reset();
    check(callAcl([], '"v1"', null, 'GRV-000208/../private')->status === 400 && Fixture::$events === [], 'path traversal forbidden');
    Fixture::reset(); Fixture::$provider = 'sqlite';
    check(callAcl()->status === 503 && Fixture::$events === [], 'unsupported native transaction backend forbidden');
    Fixture::reset(); Fixture::$badReadback = true;
    try { callAcl(); throw new \LogicException('readback failure did not reject'); }
    catch (\RuntimeException $error) { check(Fixture::$rules === [] && end(Fixture::$events) === 'rollback', 'failed readback must roll back native writes'); }
    Fixture::reset(); Fixture::$readable = false;
    check(callAcl()->status === 400 && !Fixture::$written && !Fixture::$locked, 'cannot remove service read access');
    echo "native-acl-controller-regressions-passed\n";
}
