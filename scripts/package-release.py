"""Create platform-neutral DSH release assets from an exported delivery directory."""
import hashlib
import json
from pathlib import Path
import sys
import tarfile
import zipfile

source = Path(sys.argv[1]).resolve()
manifest = json.loads((source / 'delivery-files.json').read_text(encoding='utf-8'))
files = sorted(p for p in source.rglob('*') if p.is_file())
assert {p.relative_to(source).as_posix() for p in files} == set(manifest['files']) | {'delivery-files.json'}
assert not any(p.is_symlink() for p in source.rglob('*'))
archives = []
with tarfile.open(source.parent / (source.name + '.tgz'), 'w:gz') as archive:
    archive.add(source, arcname=source.name)
archives.append(source.parent / (source.name + '.tgz'))
with zipfile.ZipFile(source.parent / (source.name + '.zip'), 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    for path in files:
        archive.write(path, arcname=source.name + '/' + path.relative_to(source).as_posix())
archives.append(source.parent / (source.name + '.zip'))
(source.parent / 'SHA256SUMS.txt').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest() + '  ' + p.name + '\n' for p in archives), encoding='utf-8')
print(json.dumps({'version': manifest['version'], 'files': len(files), 'archives': [str(p) for p in archives]}, ensure_ascii=False))
