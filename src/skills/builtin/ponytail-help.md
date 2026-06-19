---
name: ponytail-help
description: Quick-reference card for all ponytail modes, skills, and commands in Sentinel. One-shot display, not a persistent mode. Trigger with /ponytail-help, "ponytail help", "what ponytail commands", or "how do I use ponytail".
license: MIT
---

<!-- Adapted from https://github.com/DietrichGebert/ponytail (MIT, DietrichGebert).
     Localized for Sentinel: slash-command invocation, Sentinel's 5 ported skills. -->

# Ponytail Help

Display this reference card when invoked. One-shot, do NOT change mode,
write flag files, or persist anything.

## Levels

| Level | Trigger | What change |
|-------|---------|-------------|
| **Lite** | `/ponytail lite` | Build what's asked, name the lazier alternative in one line. |
| **Full** | `/ponytail` | The ladder enforced: YAGNI → stdlib → native → one line → minimum. Default. |
| **Ultra** | `/ponytail ultra` | YAGNI extremist. Deletion before addition. Challenges requirements before building. |

Level sticks until changed or session end.

## Skills

| Skill | Trigger | What it does |
|-------|---------|--------------|
| **ponytail** | `/ponytail` | Lazy mode itself. Simplest solution that works. |
| **ponytail-review** | `/ponytail-review` | Over-engineering review of a diff: `L42: yagni: factory, one product. Inline.` |
| **ponytail-audit** | `/ponytail-audit` | Repo-wide audit: ranked list of what to delete/simplify. |
| **ponytail-debt** | `/ponytail-debt` | Harvest `ponytail:` comments into a debt ledger. |
| **ponytail-help** | `/ponytail-help` | This card. |

In Sentinel, invoke any skill with its slash command (e.g. `/ponytail-review`)
or by mentioning the name in conversation ("review for over-engineering").

## Deactivate

Say "stop ponytail" or "normal mode". Resume anytime with `/ponytail`.
`/ponytail off` also works.

## Marking shortcuts

When ponytail ships a deliberate simplification, drop a comment naming its
ceiling and upgrade path:

```ts
// ponytail: global lock, per-account locks if throughput matters
```

Later, `/ponytail-debt` collects every marker into a tracked ledger so a
deferral can't quietly become permanent.

## More

Upstream project + full docs: https://github.com/DietrichGebert/ponytail
