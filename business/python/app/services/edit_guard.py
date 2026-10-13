from ..config import data_dir
from .errors import BusinessError
def require_idle(task_id):
    if (data_dir()/'locks'/task_id).exists():
        raise BusinessError(409,'当前项目正在执行，请停止或在本轮结束后保存修改')
