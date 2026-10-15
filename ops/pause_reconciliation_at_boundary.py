"""Reserve a fail-closed audit sentinel; let the current batch commit normally."""
import json,os,re
from pathlib import Path
ROOT=Path('/var/lib/gravitas-source-migrations/team-docs-20261015-v1')


def main():
    for _ in range(4):
        indices=[int(m.group(1)) for p in ROOT.glob('audit-*.json') if (m:=re.fullmatch(r'audit-(\d{3})\.json',p.name))]
        index=max(indices,default=-1)+1
        if index>=32:
            print(json.dumps({'pause':'not_needed_all_batches_started'}));return
        path=ROOT/f'audit-{index:03d}.json'
        try:
            with path.open('x') as out:
                os.chmod(path,0o600)
                out.write(json.dumps({'state':'pause_requested_for_controlled_deployment','reason':'Deploy the tested Core board canonical edit compatibility before continuing historical import.','no_task_mutation':True}))
                out.flush();os.fsync(out.fileno())
        except FileExistsError:
            continue
        print(json.dumps({'pause_before_batch':index,'current_batch_may_finish_normally':True,'sentinel':path.name}));return
    raise ValueError('could_not_reserve_safe_pause_boundary')


if __name__=='__main__':
    main()
