"""按招标依据设置项目格式；未规定的项目使用统一缺省值。"""
import hashlib
import re
from typing import Literal
from .. import runctx, artifact_store
from ..services import build_state, document_format
from ..work_paths import resolve_work_path


def docx_format_rule(target: Literal['read','body','heading1','heading2','heading3','heading4','heading5','heading6','heading7','heading8','heading9','footer'] = 'read',
                     font: str = '', font_size: float = 0, line_spacing: float = 0,
                     spacing_rule: Literal['multiple','exact'] = 'multiple',
                     footer_text: str = '', alignment: Literal['','center','left','right'] = '',
                     evidence_path: str = '', evidence_quote: str = '', reset: bool = False, reason: str = '') -> dict:
    """读取默认/本项目规则，或用招标解析原文覆盖指定正文/标题/页脚规则。

    小四=12pt。正文未规定时宋体12pt、1.5倍；标题使用原生Heading1..9。
    覆盖须给work/parse下文件相对路径及逐字引用，不能用素材格式、猜测或用户写作内容冒充招标要求。
    footer_text使用{PAGE}和{TOTAL}两个域占位符，默认第 {PAGE}页，共{TOTAL}页。
    分节或页码计数另有特殊规定时先说明，不能把不支持的规则悄悄降为默认。
    read始终返回待核对项，失效规则仍阻止合册。依据变化后逐目标重新设置；
    当前原文已取消该目标的格式要求时，附当前依据及至少12字reason，reset=true清除该目标旧覆盖。
    reset也可与新值同传，完整替换该目标规则；其他目标不变。不能仅为通过校验清除要求。
    """
    tid=runctx.current_run().task_id
    if target=='read':
        return {'defaults':document_format.DEFAULT_BODY,**document_format.inspect_rules(tid),
                'pagination':'封面独立无页码；目录从1开始，目录、正文、附件连续计入总页数',
                'format_requirements_path':'analysis/requirements-format.md'}
    path=resolve_work_path(tid,evidence_path)
    if not path.is_relative_to((artifact_store.work_dir(tid)/'parse').resolve()) or path.suffix!='.md':
        raise ValueError('格式依据只允许本任务work/parse中的招标解析原文')
    raw=path.read_text()
    if not evidence_quote.strip() or evidence_quote not in raw:
        raise ValueError('格式依据须逐字存在于招标解析原文')
    if reset and len(reason.strip()) < 12:
        raise ValueError('重置格式覆盖须说明至少12字的当前依据核对理由')
    values={}
    if font:
        if font not in evidence_quote:raise ValueError('字体名称未出现在引用原文中')
        values['font']=font
    if font_size:
        sizes={9:'小五',10.5:'五号',12:'小四',14:'四号',15:'小三',16:'三号',18:'小二',22:'二号',24:'小一',26:'一号'}
        if font_size<=0 or not (re.search(r'(?<![\d.])'+re.escape(f'{font_size:g}')+r'\s*(?:磅|pt)', evidence_quote,re.I) or re.search(r'(?<!小)'+re.escape(sizes.get(font_size,'不存在字号')),evidence_quote)):
            raise ValueError('字号须与引用原文对应；填写磅数，如小四12')
        values['font_size']=font_size
    if line_spacing:
        unit=r'倍' if spacing_rule=='multiple' else r'(?:磅|pt)'
        if line_spacing<=0 or not re.search(r'(?<![\d.])'+re.escape(f'{line_spacing:g}')+r'\s*'+unit,evidence_quote,re.I):
            raise ValueError('行距须与引用原文对应')
        values.update(line_spacing=line_spacing,spacing_rule=spacing_rule)
    if target=='footer':
        if footer_text:
            if footer_text.count('{PAGE}')!=1 or footer_text.count('{TOTAL}')!=1:raise ValueError('页脚格式须各含一次{PAGE}与{TOTAL}')
            values['footer_text']=footer_text
        if alignment:
            words={'center':('居中','中间'),'left':('居左','左对齐'),'right':('居右','右对齐')}
            if not any(word in evidence_quote for word in words[alignment]):raise ValueError('页脚对齐方式须与引用原文对应')
            values['alignment']=alignment
    elif footer_text:raise ValueError('页脚格式只可用于footer规则')
    if not values and not reset:raise ValueError('没有明确格式覆盖值')
    with artifact_store.write_lock():
        state=build_state.read(tid)
        if reset:
            previous=state.setdefault('document_format',{}).pop(target,{})
            state.setdefault('document_format_reviews',[]).append({'target':target,'previous':previous,'reason':reason,
                'evidence_path':path.relative_to(artifact_store.work_dir(tid)).as_posix(),'evidence_quote':evidence_quote,
                'evidence_sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
        properties=state.setdefault('document_format',{}).setdefault(target,{})
        for name,value in values.items():
            properties[name]={'value':value,'evidence_path':path.relative_to(artifact_store.work_dir(tid)).as_posix(),'evidence_quote':evidence_quote,'evidence_sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
        build_state.save(tid,state)
    return {'target':target,**document_format.inspect_rules(tid)}
