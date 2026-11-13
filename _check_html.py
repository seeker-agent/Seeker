import re

VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr", "path", "circle", "rect", "svg"}

for name in ("index.html", "pricing.html", "dashboard.html"):
    text = open(name, encoding="utf-8").read()
    stack = []
    errors = []
    for m in re.finditer(r"<(/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*?)(/?)>", text):
        closing, tag, attrs, selfclose = m.group(1), m.group(2).lower(), m.group(3), m.group(4)
        if tag in ("!doctype",):
            continue
        if tag in VOID or selfclose == "/":
            continue
        if closing:
            if stack and stack[-1][0] == tag:
                stack.pop()
            else:
                errors.append("unexpected </%s> at %d" % (tag, m.start()))
        else:
            stack.append((tag, m.start()))
    print(name, "| open left:", [(t, p) for t, p in stack], "| errors:", errors[:5])
