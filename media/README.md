# Marks and icons

`key.svg` is the activity bar icon: KeY's own keyhole, traced from
`de/uka/ilkd/key/gui/images/key-color-icon-square.png` in a KeY distribution into one path,
because an activity bar icon is named in `package.json` and resolved when the extension
loads, before any KeY is configured. Everything else KeY draws is fetched from the KeY the
user configured, at run time.

`tools/trace-logo.py` made it, and makes it again if KeY's logo changes:

```
python3 tools/trace-logo.py <key-color-icon-square.png> 24 0.8 > media/key.svg
```

`mark-closed.svg`, `mark-lemmas-left.svg` and `mark-open.svg` are the gutter marks. They are
drawn here rather than taken from KeY, since KeY has no gutter and draws no such thing.
