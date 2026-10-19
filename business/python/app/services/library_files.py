"""Validated replacement uploads and cross-process library mutation locks."""
from contextlib import asynccontextmanager, contextmanager
from pathlib import Path
import hashlib
import uuid
from filelock import Timeout
from ..config import data_dir
from ..file_lock import file_lock
from .errors import BusinessError

@contextmanager
def mutation_lock(domain: str, key: str):
    try:
        with file_lock(data_dir() / 'library-operations' / domain / key, timeout=0):
            yield
    except Timeout:
        raise BusinessError(409, '该资料正在处理，请稍后重新读取再操作') from None

@asynccontextmanager
async def replacement_upload(file, directory: Path, allowed: set[str], limit: int | None):
    name = Path(file.filename or '').name.strip()
    if not name or name.startswith('.') or Path(name).suffix.lower() not in allowed:
        raise BusinessError(422, '请选择支持的文件格式：' + ' / '.join(sorted(allowed)))
    directory.mkdir(parents=True, exist_ok=True)
    temp = directory / ('.replacement-' + uuid.uuid4().hex + '.part')
    digest = hashlib.sha256()
    size = 0
    try:
        with temp.open('wb') as out:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if limit is not None and size > limit:
                    raise BusinessError(413, f'文件超过 {limit // 1024 // 1024} MB 上限')
                digest.update(chunk)
                out.write(chunk)
        if not size:
            raise BusinessError(422, '文件内容为空，请重新选择')
        try:
            ext = Path(name).suffix.lower()
            if ext == '.docx':
                from docx import Document
                Document(temp)
            elif ext == '.pdf':
                import pypdfium2 as pdfium
                with pdfium.PdfDocument(temp) as doc:
                    if not len(doc):
                        raise ValueError('没有页面')
            else:
                from PIL import Image
                with Image.open(temp) as image:
                    image.verify()
        except Exception as error:
            raise BusinessError(422, '文件损坏或与扩展名不符，请重新选择有效文件') from error
        yield temp, name, digest.hexdigest()
    finally:
        temp.unlink(missing_ok=True)
