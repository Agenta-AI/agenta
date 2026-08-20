import re, subprocess, os, collections

# Files the lane changed vs 112.2 (the blast radius).
changed = subprocess.run(
    ["git","diff","--name-only","origin/release/v0.112.2","HEAD","--",
     "web/oss/src","web/ee/src","web/packages"],
    capture_output=True, text=True).stdout.split()
changed = [f for f in changed if f.endswith((".ts",".tsx")) and os.path.exists(f)
           and "/tests/" not in f and not f.endswith((".test.ts",".test.tsx",".stories.tsx"))]

# Every symbol exported by those files, restricted to components/hooks (the droppable kind).
exp = re.compile(r'^export\s+(?:default\s+)?(?:async\s+)?(?:const|function|class)\s+([A-Za-z_]\w*)', re.M)
cand = {}
for f in changed:
    src = open(f, encoding="utf-8", errors="ignore").read()
    for m in exp.finditer(src):
        n = m.group(1)
        if n[0].isupper() or n.startswith("use"):
            cand.setdefault(n, f)

# Count references across the whole web tree, excluding the defining file itself.
orphans = []
for name, home in cand.items():
    r = subprocess.run(["grep","-rl","--include=*.ts","--include=*.tsx","-w",name,
                        "web/oss/src","web/ee/src","web/packages/","web/mobile/src"],
                       capture_output=True, text=True).stdout.split()
    others = [x for x in r if x != home and "/.next/" not in x]
    if not others:
        orphans.append((name, home))

print(f"scanned {len(changed)} changed files, {len(cand)} exported components/hooks")
print(f"ZERO-CONSUMER exports: {len(orphans)}\n")
by_dir = collections.defaultdict(list)
for n,h in orphans: by_dir[os.path.dirname(h)].append(n)
for d in sorted(by_dir, key=lambda k: -len(by_dir[k])):
    print(f"{d}\n    " + ", ".join(sorted(by_dir[d])))
