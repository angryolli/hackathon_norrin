from __future__ import annotations

import uuid

import pandas as pd

from app.models.schemas import (
    CompileRuleResponse,
    QualityItem,
    RuleSchema,
)


def compile_rule(rule: RuleSchema, columns: list[str], batch: pd.DataFrame) -> CompileRuleResponse:
    if rule.column not in columns:
        return CompileRuleResponse(
            rule_id="",
            compiled=False,
            dry_run_result="fail",
            evidence=f"column {rule.column} not in {columns}",
        )
    rule_id = f"rule_{uuid.uuid4().hex[:8]}"
    item = _eval_rule(batch, rule_id, rule)
    return CompileRuleResponse(
        rule_id=rule_id,
        compiled=True,
        dry_run_result=item.status,
        evidence=item.evidence,
    )


def run_custom_rules(
    batch: pd.DataFrame, custom: list[tuple[str, RuleSchema]]
) -> list[QualityItem]:
    return [_eval_rule(batch, rid, rule) for rid, rule in custom]


def _eval_rule(batch: pd.DataFrame, rule_id: str, rule: RuleSchema) -> QualityItem:
    if rule.column not in batch:
        return QualityItem(
            name=f"custom:{rule.column}",
            status="fail",
            evidence="column missing in batch",
            originating_rule_id=rule_id,
            sensor_fault=False,
        )
    s = pd.to_numeric(batch[rule.column], errors="coerce").tail(rule.window)
    status = "pass"
    evidence = ""
    sensor_fault = False
    if rule.condition == "gt":
        hit = bool((s > rule.threshold).any())
        status = "fail" if hit else "pass"
        evidence = f"max={s.max()} threshold={rule.threshold}"
    elif rule.condition == "lt":
        hit = bool((s < rule.threshold).any())
        status = "fail" if hit else "pass"
        evidence = f"min={s.min()} threshold={rule.threshold}"
    elif rule.condition == "abs_gt":
        hit = bool((s.abs() > rule.threshold).any())
        status = "fail" if hit else "pass"
        evidence = f"max_abs={s.abs().max()} threshold={rule.threshold}"
    elif rule.condition == "stuck":
        x = s.dropna().to_numpy()
        frozen = float((abs(x[1:] - x[:-1]) < 1e-9).mean()) if len(x) > 3 else 0
        hit = frozen >= rule.threshold
        status = "fail" if hit else "pass"
        sensor_fault = hit
        evidence = f"frozen_frac={frozen:.3f} threshold={rule.threshold}"
    elif rule.condition == "missing_rate":
        miss = float(s.isna().mean())
        hit = miss >= rule.threshold
        status = "fail" if hit else "pass"
        sensor_fault = hit
        evidence = f"missing={miss:.3f} threshold={rule.threshold}"
    if status == "fail" and rule.severity == "warn":
        status = "warn"
    return QualityItem(
        name=f"custom:{rule.column}:{rule.condition}",
        status=status,
        evidence=evidence,
        affected_sensors=[rule.column],
        originating_rule_id=rule_id,
        sensor_fault=sensor_fault,
    )
