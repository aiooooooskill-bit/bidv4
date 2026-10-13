"""validate_analysis 工具：要点产物机器校验（coverage/出处引用两层，golden case 校准）。"""
import json
import pytest
from app import artifact_store, runctx
from app.tools.validate_analysis import validate_analysis
from tests.util import init_env

@pytest.fixture
def env(tmp_path, monkeypatch):
    task, conv = init_env(tmp_path, monkeypatch)
    runctx.set_run(conv['id'], 'r_test', task['id'])
    yield (task, conv)
    runctx.clear_run()

def _seed(task, products, *, sources=True, parse=True):
    wroot = artifact_store.work_dir(task['id'])
    proot = wroot / 'parse'
    proot.mkdir(parents=True, exist_ok=True)
    if sources:
        (proot / 'sources.json').write_text(json.dumps({'main': '招标文件.docx', 'supplements': [{'file': '补遗1.docx', 'role': '补遗'}], 'excluded': []}, ensure_ascii=False), encoding='utf-8')
    if parse:
        for fn, n in (('招标文件.docx', 400), ('补遗1.docx', 30)):
            pdir = proot / fn
            pdir.mkdir(parents=True, exist_ok=True)
            (pdir / f'{fn}.md').write_text('行\n' * n, encoding='utf-8')
    adir = wroot / 'analysis'
    adir.mkdir(parents=True, exist_ok=True)
    for stem, content in products.items():
        (adir / f'{stem}.md').write_text(content, encoding='utf-8')

def _table_section(stem, header, rows, coverage='已检查：邀请函；未检查：无'):
    body = '\n'.join(rows)
    separator = '|' + '---|' * (header.count('|') - 1)
    return f'## 清单\n{header}\n{separator}\n{body}\n\n## coverage 声明\n{coverage}\n'

def _qual(stem='requirements-qualification', citations=('招标文件.docx 邀请函 三（L52）', '同文件 须知（L54）')):
    rows = [f'| {i} | 要求 | 材料 | 后果 | {c} |' for i, c in enumerate(citations, 1)]
    return _table_section(stem, '| 序号 | 要求 | 需证明材料 | 不通过后果 | 出处 |', rows)

def _clar():
    return '## 待澄清清单\n| 编号 | 类型 | 问题 | 影响范围 | 建议动作 |\n|---|---|---|---|---|\n| CLAR-01 | 冲突 | 两处不一致（L10/L12） | 报价 | 向招标代理确认 |\n\n## 状态\n未裁决 1 条。\n'


def test_escaped_cells_keep_citation_column_and_original_error_line(env):
    task, _ = env
    content = '~~~md\n| 序号 | 出处 |\n|---|---|\n| 伪 | 伪文件.docx L999 |\n~~~\n\n' + _qual(citations=('招标文件.docx L999',))
    content = content.replace('| 要求 | 材料 |', r'| 要求 A\|B | 材料 |')
    _seed(task, {'requirements-qualification': content})
    result = validate_analysis(**{})
    assert 'requirements-qualification.md:10' in result and '超出' in result
    assert '伪文件' not in result


def test_fenced_coverage_heading_is_not_a_real_declaration(env):
    task, _ = env
    _seed(task, {'requirements-qualification': '~~~md\n## coverage 声明\n已检查：全部；未检查：无\n~~~\n'})
    assert '缺「## coverage 声明」段' in validate_analysis(**{})

def _all_compliant():
    """八件全合规（引用形态覆盖：显式锚/同文件锚/斜杠继承/分号独立锚/括号内行文注释）。"""
    return {'structure': _table_section('structure', '| 字段 | 值 | 状态 | 出处 |', ['| 项目名称 | X | 确认 | 招标文件.docx 封面（L3） |', '| 采购方式 | Y | 确认 | 同文件 邀请函 1.3（L28）/ 前附表（L100） |'], coverage='已检查：封面、邀请函；未检查：无').replace('## coverage 声明', '## 四、coverage 声明'), 'requirements-qualification': _qual(), 'requirements-submission': _table_section('requirements-submission', '| 序号 | 规则 | 高风险 | 后果 | 出处 |', ['| 1 | 截止时间 | 是 | 拒收 | 招标文件.docx 邀请函（L52；后果见同文件 须知 20.1（L210）） |']), 'requirements-business': _table_section('requirements-business', '| 需求（原文 verbatim 片段） | 出处（章/节/附件编号） |', ['| 支持 500 并发 | 招标文件.docx 第三章 2.1（L10）；补遗1.docx L6-L7（场景补充） |']), 'requirements-format': _table_section('requirements-format', '| 序号 | 章节名称 | 归属(bidPart) | 原文出处线索 |', ['| 1 | 授权委托书 | qualification | 招标文件.docx 附件4（L12-L14） |']).replace('## coverage 声明', '## 三、招标方给出的章节示例 / 模板\n| 序号 | 模板名称 | 归属(bidPart) | 对应必须章节 | 原文出处线索 |\n|---|---|---|---|---|\n\n## coverage 声明'), 'disqualification': _table_section('disqualification', '| 序号 | 触发条件 | 后果 | 严重度 | 出处 |', ['| 1 | 迟到 | 拒收 | 高 | 招标文件.docx 邀请函 六（L79）/ 须知 19.1（L207） |'], coverage='已检查：全文；未检查：无\n反查词表：无效、否决、拒收。'), 'evaluation': _table_section('evaluation', '| 评分项 | 分值 | 评分要点 | 出处 |', ['| 技术方案 | 30 | 完整性 | 招标文件.docx 评标办法 附表（L171-L172） |']), 'clarifications': _clar()}

def test_all_compliant_passes(env):
    task, _ = env
    _seed(task, _all_compliant())
    r = validate_analysis(**{})
    assert r.startswith('[校验通过]')
    assert '共 8 件' in r
    assert '⚠️' not in r


@pytest.mark.parametrize('bad_separator', ['|---|---|', '|---|---|---|---|---|---|', ''])
def test_malformed_required_table_cannot_skip_bad_citations(env, bad_separator):
    task, _ = env
    content = _qual(citations=('不存在.docx L999',)).replace('|---|---|---|---|---|', bad_separator)
    _seed(task, {'requirements-qualification': content})
    result = validate_analysis()
    assert result.startswith('[校验未通过]')
    assert 'requirements-qualification.md 缺少合法的必需表格' in result


@pytest.mark.parametrize('stem', ['structure', 'requirements-qualification', 'requirements-submission', 'requirements-business', 'requirements-format', 'disqualification', 'evaluation', 'clarifications'])
def test_fenced_required_tables_do_not_satisfy_contract(env, stem):
    from app.markdown import sections
    task, _ = env
    original = _all_compliant()[stem]
    cover = next((body for heading, body in sections(original, 2) if 'coverage' in heading.title), '')
    content = '~~~md\n' + original + '\n~~~\n\n'
    if cover:
        content += '## coverage 声明\n' + cover
    _seed(task, {stem: content})
    result = validate_analysis()
    assert result.startswith('[校验未通过]')
    assert '缺少合法的必需表格' in result


def test_format_requires_both_tables_even_when_one_is_valid(env):
    task, _ = env
    original = _all_compliant()['requirements-format']
    content = original.replace('|---|---|---|---|---|', '|---|---|')
    _seed(task, {'requirements-format': content})
    assert '缺少合法的必需表格「序号 | 模板名称' in validate_analysis()


def test_empty_required_tables_are_valid_and_not_substituted_by_prose(env):
    task, _ = env
    content = _qual(citations=()) + '\n已检查范围内未发现资格要求。\n'
    _seed(task, {'requirements-qualification': content})
    result = validate_analysis()
    assert result.startswith('[校验通过]')
    assert '0 条' in result


@pytest.mark.parametrize('replacement', ['来源', '证明材料'])
def test_wrong_header_cannot_satisfy_required_table(env, replacement):
    task, _ = env
    column = '出处' if replacement == '来源' else '需证明材料'
    _seed(task, {'requirements-qualification': _qual().replace(column, replacement)})
    assert '缺少合法的必需表格' in validate_analysis()

def test_no_task_context(tmp_path, monkeypatch):
    init_env(tmp_path, monkeypatch)
    runctx.clear_run()
    assert validate_analysis(**{}).startswith('[校验失败] 缺少任务上下文')

def test_missing_analysis_dir(env):
    task, _ = env
    r = validate_analysis(**{})
    assert r.startswith('[校验失败]')

def test_missing_coverage_and_structure_numbered_ok(env):
    task, _ = env
    products = _all_compliant()
    products['requirements-submission'] = '## 递交要求清单\n| 序号 | 规则 | 高风险 | 后果 | 出处 |\n|---|---|---|---|---|\n| 1 | 截止 | 是 | 拒收 | 招标文件.docx 邀请函（L52） |\n'
    _seed(task, products)
    r = validate_analysis(**{})
    assert 'requirements-submission.md 缺「## coverage 声明」段' in r

def test_disqualification_needs_backcheck_words(env):
    task, _ = env
    products = _all_compliant()
    products['disqualification'] = _table_section('disqualification', '| 序号 | 触发条件 | 后果 | 严重度 | 出处 |', ['| 1 | 迟到 | 拒收 | 高 | 招标文件.docx 邀请函 六（L79） |'], coverage='已检查：全文；未检查：无')
    _seed(task, products)
    r = validate_analysis(**{})
    assert '缺「反查词表：」' in r

def test_citation_missing_prefix(env):
    task, _ = env
    products = _all_compliant()
    products['requirements-qualification'] = _qual(citations=('招标文件.docx 邀请函 三（L52）', '须知 20.1（L210）'))
    _seed(task, products)
    r = validate_analysis(**{})
    assert '缺文件名或「同文件」前缀' in r
    assert 'requirements-qualification.md:5' in r

def test_citation_slash_inherits_anchor(env):
    """「/」分隔段继承前段锚——golden disqualification 首行形态。"""
    task, _ = env
    products = _all_compliant()
    products['requirements-qualification'] = _qual(citations=('招标文件.docx 邀请函 六（L79）/ 须知 19.1（L207）',))
    _seed(task, products)
    r = validate_analysis(**{})
    assert r.startswith('[校验通过]')

def test_citation_unknown_filename(env):
    task, _ = env
    products = _all_compliant()
    products['requirements-qualification'] = _qual(citations=('招标文件2.docx A（L10）',))
    _seed(task, products)
    r = validate_analysis(**{})
    assert '文件名「招标文件2.docx」不在已确认来源集合' in r

def test_citation_line_over_limit(env):
    task, _ = env
    products = _all_compliant()
    products['requirements-qualification'] = _qual(citations=('招标文件.docx A（L450）',))
    _seed(task, products)
    r = validate_analysis(**{})
    assert '行号 L450' in r and '总行数 400' in r

def test_citation_no_parse_product(env):
    task, _ = env
    products = _all_compliant()
    products['requirements-qualification'] = _qual(citations=('补遗1.docx A（L10）',))
    wroot = artifact_store.work_dir(task['id'])
    _seed(task, products)
    (wroot / 'parse' / '补遗1.docx' / '补遗1.docx.md').unlink()
    r = validate_analysis(**{})
    assert '「补遗1.docx」没有解析产物' in r

def test_citation_empty_cell(env):
    task, _ = env
    products = _all_compliant()
    products['requirements-qualification'] = _qual(citations=('招标文件.docx A（L10）', ''))
    _seed(task, products)
    r = validate_analysis(**{})
    assert '出处列为空' in r

def test_clarifications_missing_is_warning_not_issue(env):
    task, _ = env
    products = _all_compliant()
    del products['clarifications']
    _seed(task, products)
    r = validate_analysis(**{})
    assert r.startswith('[校验通过]')
    assert '⚠️ clarifications.md 不存在' in r

def test_business_plain_column_alias(env):
    """business 表头写简写「出处」（assemble 按第 2 列取值）也要校验到。"""
    task, _ = env
    products = _all_compliant()
    products['requirements-business'] = _table_section('requirements-business', '| 需求 | 出处 |', ['| 支持并发 | 须知 20.1（L210） |'])
    _seed(task, products)
    r = validate_analysis(**{})
    assert 'requirements-business.md:4' in r and '缺文件名或「同文件」前缀' in r

def test_no_sources_json_downgrades_to_format_only(env):
    task, _ = env
    products = _all_compliant()
    products['requirements-qualification'] = _qual(citations=('须知 20.1（L210）',))
    _seed(task, products, sources=False)
    r = validate_analysis(**{})
    assert '缺文件名或「同文件」前缀' in r
    assert '⚠️ sources.json 不存在' in r

def test_paren_annotation_no_false_positive(env):
    """golden 误报回归：括号内「；后果见同文件 …（L…）」是行文注释不是多出处。"""
    task, _ = env
    products = _all_compliant()
    products['requirements-qualification'] = _qual(citations=('招标文件.docx 邀请函 三（L52；对应材料见第五章 9（L331））',))
    _seed(task, products)
    r = validate_analysis(**{})
    assert r.startswith('[校验通过]')
