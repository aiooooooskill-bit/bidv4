from app.services.outline_units import decision_units


def test_enumerated_points_are_individual_decisions_without_losing_details():
    reg = {'SCORE-01': {'评分要点': '含四项：1 完整性（含工商及税务）；2 园区场景；3 覆盖范围；4 时效性'}}
    units = decision_units(reg)
    assert len(units) == 5
    assert units['SCORE-01:2']['text'] == '完整性（含工商及税务）；'
    assert units['SCORE-01:5']['text'] == '时效性'


def test_proof_and_bands_are_not_automatically_titled():
    reg = {'SCORE-01': {'评分要点': '①认证甲得1分；②认证乙得2分。提供证书复印件'},
           'SCORE-02': {'评分要点': '8-10分：方案完整；5-7分：比较完整；1-4分：基本完整'}}
    units = decision_units(reg)
    assert len(units) == 5
    assert all('kind' not in u for u in units.values())


def test_no_score_does_not_skip_explicit_req_classification():
    reg = {'REQ-01': {'text': '服务方案须分别说明接口对接方案和故障处置方案'},
           'REQ-02': {'text': '每周一次例会，服务期三个月'}}
    units = decision_units(reg)
    assert [u['text'] for u in units.values() if u['review_required']] == ['接口对接方案', '故障处置方案']
    assert all('kind' not in u for u in units.values())


def test_case_threshold_does_not_split_parenthetical_or_conjunctive_conditions():
    text = '2023年起拥有省分行级（含）以上及城商行总行的数据采购案例，数据维度至少包含5项；须提供合同关键页或中标通知书；案例不超过20个'
    units = decision_units({'SCORE-02': {'评分要点': text}})
    assert len(units) == 3
    assert units['SCORE-02:1']['text'] == text.split('；')[0]
    assert not any(u['text'] == '以上' for u in units.values())
    assert all('kind' not in u and 'explicit_classification' not in u for u in units.values())


def test_nested_numbered_details_do_not_become_top_level_units():
    text = '1 数据安全（含①加密；②权限）；2 数据质量（字段甲、乙）'
    units = decision_units({'SCORE-01': {'评分要点': text}})
    assert len(units) == 2
    assert '①加密；②权限' in units['SCORE-01:1']['text']


def test_separately_provided_fields_are_candidates_not_mandatory_headings():
    units = decision_units({'REQ-01': {'text': '分别提供姓名、手机和邮箱'}})
    assert [u['text'] for u in units.values()] == ['姓名', '手机', '邮箱']
    assert all('kind' not in u and 'explicit_classification' not in u for u in units.values())


def test_format_scheme_categories_are_reviewed_even_without_scores():
    text = '其他材料（包括但不限于实施方案、集成方案、运维方案）（如有要求）'
    units = decision_units({'MAND-04': {'text': text}})
    assert [u['text'] for u in units.values()] == ['实施方案', '集成方案', '运维方案']
    assert all(u['review_required'] and text in u['review_context'] for u in units.values())
    assert all('kind' not in u for u in units.values())


def test_simple_parent_scheme_and_proof_list_do_not_invent_categories():
    units = decision_units({'MAND-01': {'text': '服务方案（含证书、联系人、费用明细）'}})
    assert len(units) == 1 and not next(iter(units.values()))['review_required']
