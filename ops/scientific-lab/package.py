"""Build a hash-checked, Lab-only release; no backend dependencies or unrelated assets."""
import hashlib, json, pathlib, subprocess, sys, tarfile
root = pathlib.Path(__file__).resolve().parents[2]
base = '511f35b5abeca3fcd8731654e5f325e9dfe24c10'
paths = ['backend/core/apps.py','backend/core/urls.py','backend/gravitas_backend/settings.py',
 'backend/core/scientific_lab_models.py','backend/core/scientific_lab_methods.py',
 'backend/core/scientific_lab_sources.py','backend/core/scientific_lab_runner.py',
 'backend/core/scientific_lab_api.py','backend/core/migrations/0076_scientific_lab_runs.py',
 'backend/core/management/commands/process_scientific_labs.py','lab.html',
 'lab-scientific-visualization.html','lab-ai-reliability.html','lab-observations.html',
 'assets/labs/research.js','assets/labs/research.css','assets/labs/observations.js',
 'assets/labs/data/noaa-co2.json','assets/labs/data/noaa-co2-source.csv']
manifest=[]
for path in paths:
    prior=subprocess.run(['git','show',base+':'+path],cwd=root,capture_output=True)
    manifest.append(dict(path=path, before=hashlib.sha256(prior.stdout).hexdigest() if prior.returncode==0 else None,
                         after=hashlib.sha256((root/path).read_bytes()).hexdigest()))
out=pathlib.Path(sys.argv[1]); out.mkdir(parents=True,exist_ok=True)
(out/'manifest.json').write_text(json.dumps(manifest))
with tarfile.open(out/'lab-release.tar.gz','w:gz') as archive:
    for path in paths: archive.add(root/path,arcname=path)
    archive.add(out/'manifest.json',arcname='manifest.json')
    for path in ['deploy.py','gravitas-scientific-lab.service','gravitas-scientific-lab.timer']:
        archive.add(root/'ops/scientific-lab'/path,arcname=path)
print('Lab-only package prepared:', len(paths), 'files')
