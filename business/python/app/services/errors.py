from pathlib import Path
class BusinessError(Exception):
    def __init__(self,status_code,detail):
        super().__init__(str(detail));self.status_code=status_code;self.detail=str(detail)
class FileDownload:
    def __init__(self,path,filename=None,media_type=None,headers=None):
        self.path=str(path);self.filename=filename or Path(path).name;self.media_type=media_type or 'application/octet-stream'
class Response:
    def __init__(self,content,media_type=None,headers=None):
        self.content=content;self.media_type=media_type or 'application/octet-stream'
class IncomingFile:
    def __init__(self,path,filename):self.filename=filename;self.stream=open(path,'rb')
    async def read(self,n=-1):return self.stream.read(n)
    async def close(self):self.stream.close()
