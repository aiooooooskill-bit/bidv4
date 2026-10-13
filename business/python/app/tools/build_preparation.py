from .. import runctx
from ..services import build_state


def build_preparation(stage: str = 'read') -> str:
    """读取制作规划是否需要更新；完成并校验写作指引后传 guide，完成承诺清单后传 promises，保存当前编写依据。读取 read 不写文件。"""
    import json
    tid = runctx.current_run().task_id
    if stage != 'read':
        build_state.record_preparation(tid, stage, runctx.current_run().conversation_id)
    from ..services.bidder import status
    return json.dumps({**build_state.snapshot(tid),'bidder':status(tid)}, ensure_ascii=False)
