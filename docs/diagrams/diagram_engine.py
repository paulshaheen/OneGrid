"""Lane-and-card architecture drawings for OneGrid, written as static SVG.

Standard library only. A Sheet holds lanes (filled bands), boundaries (outlined
service, network or trust zones), cards (one capability each, with its official
icon), notes, and flows (orthogonal connectors). ``Sheet.validate()`` checks text
fit, overlap, routing and label placement before anything is written, so a layout
mistake fails the build instead of shipping as a clipped or ambiguous drawing.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass, field
from hashlib import sha256
from html import escape
import json
from pathlib import Path
import re

HERE = Path(__file__).resolve().parent
ASSETS = HERE / "assets"

SANS = "'Segoe UI', 'Segoe UI Variable Text', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif"
MONO = "'Cascadia Mono', Consolas, 'SFMono-Regular', Menlo, 'Liberation Mono', monospace"

THEMES = {
    "light": {
        "bg": "#FFFFFF", "lane": "#EEF2F5", "ink": "#14202B", "muted": "#4D5D6A",
        "faint": "#728391", "rule": "#D3DBE1", "boundary": "#7B91A4",
        "fabric": "#1E7862", "fabric_fill": "#EAF5F1",
        "azure": "#2A63A6", "azure_fill": "#EBF2FA",
        "ext": "#7A705D", "ext_fill": "#F5F2EC",
        "neutral": "#8A9AA7", "neutral_fill": "#FFFFFF",
        "app_fill": "#F3F7FB",
        "data": "#2C7A57", "request": "#2A63A6", "control": "#B0600A",
        "identity": "#6550C9", "audit": "#687684",
        "blue": "#0F6CBD", "stage_fill": "#F3F4F6", "arrow": "#242424", "bar_fill": "#F7F8F9",
        "sub_fill": "#EEF5FC", "unit": "#C4314B", "pill_sub": "#FFE7A3", "pill_rg": "#CDEFFC", "pill_res": "#E8EBEE",
    },
    "dark": {
        "bg": "#0F161C", "lane": "#17222B", "ink": "#E4EBF0", "muted": "#A6B4BF",
        "faint": "#7A8C9A", "rule": "#2B3843", "boundary": "#5D768C",
        "fabric": "#52C4A2", "fabric_fill": "#13302A",
        "azure": "#74AAEE", "azure_fill": "#15293F",
        "ext": "#BCB198", "ext_fill": "#28251F",
        "neutral": "#748797", "neutral_fill": "#1A252E",
        "app_fill": "#131F29",
        "data": "#5FCB92", "request": "#74AAEE", "control": "#F1A242",
        "identity": "#A99AFF", "audit": "#8E9CA8",
        "blue": "#62AEF2", "stage_fill": "#18222B", "arrow": "#CBD4DC", "bar_fill": "#141D25",
        "sub_fill": "#122334", "unit": "#F2727E", "pill_sub": "#4A3C12", "pill_rg": "#12384A", "pill_res": "#26313A",
    },
}

KINDS = ("data", "request", "control", "identity", "audit")
DASH = {"control": "9 6", "identity": "2 5", "audit": "6 6"}
LEGEND = {
    "data": "Data movement; arrow shows where data goes",
    "request": "Request; arrow runs from caller to service",
    "control": "Control, trigger or binding",
    "identity": "Identity, token or grant",
    "audit": "Diagnostics and evidence, out of band",
    "dashed-data": "Optional, gated or configured path",
}
PLATFORMS = {
    "fabric": "Microsoft Fabric",
    "azure": "Azure and Microsoft Entra",
    "ext": "Customer, OT or third party",
    "neutral": "Shared rule or concept",
}
GLYPHS = ("database", "globe", "document", "gauge", "network", "shield", "clock", "window", "api", "chat")

# Card typography and rhythm (SVG user units).
TITLE, BODY, SERVICE, LABEL = 15, 13, 12, 12
ICON, PAD, ICON_GAP = 30, 14, 12
TITLE_BASE, FIRST_LINE, LINE = 31, 52, 18


def text_width(text, size, weight=400, mono=False):
    """Conservative advance-width estimate for Segoe UI and common fallbacks."""
    if mono:
        return len(text) * size * 0.62
    units = 0.0
    for ch in text:
        if ch in "iljI.,:;|!'`":
            units += 0.26
        elif ch in "frt()[]{}/\\-\" ":
            units += 0.34
        elif ch in "mwMW@%":
            units += 0.86
        elif ch.isdigit():
            units += 0.56
        elif ch.isupper():
            units += 0.64
        elif ch.islower():
            units += 0.53
        elif ch in "→←↔":
            units += 0.92
        elif ch in "·":
            units += 0.3
        else:
            units += 0.62
    if weight >= 600:
        units *= 1.07
    return units * size * 1.04


@dataclass
class Group:
    id: str
    x: float
    y: float
    w: float
    h: float
    title: str
    note: str = ""
    style: str = "band"          # band | boundary | app | stage | zone | bar | subscription
    icon: str | None = None
    dashed: bool = False
    accent: bool = False         # scale-unit boundary drawn in the accent colour


@dataclass
class Card:
    id: str
    x: float
    y: float
    w: float
    h: float
    title: str
    lines: tuple = ()
    service: str | None = None
    icon: str | None = None
    platform: str = "azure"
    optional: bool = False
    parent: str | None = None
    role: str = "card"           # card | view | note | node | row
    icon_size: int = 44
    caption: str | None = None
    font: float = 13
    meta: dict = field(default_factory=dict)

    def icon_rect(self):
        """For icon-first nodes: the icon square, which flows attach to."""
        cx = self.x + self.w / 2
        return (cx - self.icon_size / 2, self.y, self.icon_size, self.icon_size)


@dataclass
class Flow:
    id: str
    points: list
    kind: str = "data"
    label: object = None
    at: tuple | None = None
    anchor: str = "middle"
    both: bool = False
    dashed: bool = False
    src: str | None = None
    dst: str | None = None


@dataclass
class Sheet:
    name: str
    eyebrow: str
    title: str
    subtitle: str
    width: int = 1800
    height: int = 1500
    groups: list = field(default_factory=list)
    cards: list = field(default_factory=list)
    flows: list = field(default_factory=list)
    headers: list = field(default_factory=list)
    legend_at: tuple = (40, 146)
    legend_width: int | None = None
    style: str = "cards"         # cards | learn (icon-first, Azure Architecture Center grammar)
    steps: list = field(default_factory=list)
    footnote: str = ""

    # ----- building -------------------------------------------------------
    def _add_group(self, group):
        self.groups.append(group)
        return group

    def band(self, id, x, y, w, h, title, note=""):
        """A filled lane: one data domain or responsibility read left to right."""
        return self._add_group(Group(id, x, y, w, h, title, note, "band"))

    def boundary(self, id, x, y, w, h, title, note="", icon=None, dashed=False, accent=False):
        """An outlined service, network or trust boundary. accent=True marks a scale unit."""
        return self._add_group(Group(id, x, y, w, h, title, note, "boundary", icon, dashed or accent, accent))

    def subscription(self, id, x, y, w, h, title, note=""):
        """A filled subscription container with the subscription (key) icon, as in landing zone drawings."""
        return self._add_group(Group(id, x, y, w, h, title, note, "subscription", "subscriptions"))

    def strip(self, prefix, x, y, items, gap=84):
        """A row of small icons with one-line names, e.g. the governance controls on a subscription."""
        for i, (name, icon) in enumerate(items):
            self.node(f"{prefix}-{i}", x + i * gap, y, name, None, icon, w=gap - 6, size=24, font=11)

    def row(self, id, x, y, kind, name, purpose, icon=None, name_w=300, purpose_w=420):
        """Resource-organization row: icon, resource name and a shaded purpose label.
        kind is 'sub', 'rg' or 'res'."""
        icon = icon or {"sub": "subscriptions", "rg": "resource-group"}.get(kind)
        card = Card(id, x, y, 34 + name_w + purpose_w, 28, name, (purpose,), None, icon, "neutral",
                    False, None, "row", 22 if kind == "res" else 26, None, 12.5,
                    {"kind": kind, "name_w": name_w, "purpose_w": purpose_w})
        self.cards.append(card)
        return card

    def app(self, id, x, y, w, h, title, note="", icon=None):
        """A filled application container that holds view cards."""
        return self._add_group(Group(id, x, y, w, h, title, note, "app", icon))

    def stage(self, id, x, y, w, h, title=""):
        """Dashed stage container (Data sources, Store, Process...); its title sits above it."""
        return self._add_group(Group(id, x, y, w, h, title, "", "stage"))

    def zone(self, id, x, y, w, h, title, icon=None):
        """Dotted platform or tenant boundary with an icon and bold title inside its top edge."""
        return self._add_group(Group(id, x, y, w, h, title, "", "zone", icon))

    def bar(self, id, x, y, w, h, title, icon=None, align="center"):
        """Cross-cutting bar such as OneLake or the Platform row."""
        return self._add_group(Group(id, x, y, w, h, title, align, "bar", icon))

    def node(self, id, cx, y, name, caption=None, icon=None, w=130, size=44, optional=False, font=13):
        """Icon-first node: official icon on top, short name (and one caption line) below.
        optional=True draws a dashed outline, the convention for optional components and add-ons."""
        lines = tuple(name) if isinstance(name, (list, tuple)) else (name,)
        h = size + font + 8 + (font + 3) * (len(lines) - 1) + (15 if caption else 0)
        card = Card(id, cx - w / 2, y, w, h, lines[0], lines, None, icon, "neutral",
                    optional, None, "node", size, caption, font)
        self.cards.append(card)
        return card

    def step(self, number, x, y):
        """Numbered dataflow marker; numbers match the workflow list in the docs."""
        self.steps.append((number, x, y))

    def header(self, x, y, text, anchor="middle"):
        self.headers.append((x, y, text, anchor))

    def card(self, id, x, y, w, title, lines=(), service=None, icon=None,
             platform="azure", h=None, optional=False, parent=None):
        lines = tuple(lines)
        if h is None:
            last = y + TITLE_BASE + (FIRST_LINE - TITLE_BASE + LINE * (len(lines) - 1) if lines else 0)
            if service:
                last += 21
            h = max(ICON + 2 * PAD, last - y + 16)
        card = Card(id, x, y, w, h, title, lines, service, icon, platform, optional, parent)
        self.cards.append(card)
        return card

    def view(self, id, x, y, w, title, sub, h=56, parent=None):
        card = Card(id, x, y, w, h, title, (sub,), None, None, "neutral", False, parent, "view")
        self.cards.append(card)
        return card

    def note(self, id, x, y, w, title, lines, h=None):
        lines = tuple(lines)
        if h is None:
            h = 30 + 20 + LINE * (len(lines) - 1) + 18 if lines else 50
        card = Card(id, x, y, w, h, title, lines, None, None, "neutral", False, None, "note")
        self.cards.append(card)
        return card

    def notes(self, y, items, x=24, w=None, gap=20):
        """Lay out note cards in one row across the sheet."""
        w = w or self.width - 2 * x
        each = (w - gap * (len(items) - 1)) / len(items)
        tallest = max(len(lines) for _, lines in items)
        h = 30 + 20 + LINE * (tallest - 1) + 18
        for index, (title, lines) in enumerate(items):
            self.note(f"note-{index + 1}", x + index * (each + gap), y, each, title, lines, h)
        return y + h

    def item(self, id):
        for thing in (*self.cards, *self.groups):
            if thing.id == id:
                return thing
        raise KeyError(id)

    def port(self, id, side, offset=0):
        b = self.item(id)
        if getattr(b, "role", None) == "node":
            ix, iy, s, _ = b.icon_rect()
            return {
                "l": (ix, iy + s / 2 + offset),
                "r": (ix + s, iy + s / 2 + offset),
                "t": (ix + s / 2 + offset, iy),
                "b": (b.x + b.w / 2 + offset, b.y + b.h),
            }[side]
        return {
            "l": (b.x, b.y + b.h / 2 + offset),
            "r": (b.x + b.w, b.y + b.h / 2 + offset),
            "t": (b.x + b.w / 2 + offset, b.y),
            "b": (b.x + b.w / 2 + offset, b.y + b.h),
        }[side]

    def flow(self, id, src, dst, points=None, kind="data", label=None, at=None,
             anchor=None, both=False, dashed=False, sides=("r", "l"), offsets=(0, 0), via=None):
        """Connect two items. Without points: straight if aligned, else one elbow pair."""
        if kind not in KINDS:
            raise ValueError(f"{id}: unknown flow kind {kind}")
        if points is None:
            start = self.port(src, sides[0], offsets[0])
            end = self.port(dst, sides[1], offsets[1])
            if via is None:
                if start[0] == end[0] or start[1] == end[1]:
                    via = []
                elif sides[0] in "lr" and sides[1] in "lr":
                    mid = round((start[0] + end[0]) / 2)
                    via = [(mid, start[1]), (mid, end[1])]
                else:
                    mid = round((start[1] + end[1]) / 2)
                    via = [(start[0], mid), (end[0], mid)]
            points = [start, *via, end]
        points = [(float(x), float(y)) for x, y in points]
        flow = Flow(id, points, kind, label, at, anchor or "middle", both, dashed, src, dst)
        if label is not None and at is None:
            flow.at, flow.anchor = self._auto_label(points)
        elif anchor is None and at is not None:
            flow.anchor = "middle"
        self.flows.append(flow)
        return flow

    @staticmethod
    def _auto_label(points):
        best, length = None, -1
        for a, b in zip(points, points[1:]):
            d = abs(a[0] - b[0]) + abs(a[1] - b[1])
            if d > length:
                best, length = (a, b), d
        (x1, y1), (x2, y2) = best
        if y1 == y2:
            return ((x1 + x2) / 2, y1 - 8), "middle"
        return (x1 + 8, (y1 + y2) / 2 + 4), "start"

    # ----- geometry helpers -------------------------------------------------
    def label_lines(self, flow):
        if flow.label is None:
            return []
        return list(flow.label) if isinstance(flow.label, (list, tuple)) else [flow.label]

    def label_boxes(self, flow):
        if flow.label is None or flow.at is None:
            return []
        boxes = []
        x, y = flow.at
        for i, line in enumerate(self.label_lines(flow)):
            w = text_width(line, LABEL, 600)
            left = {"middle": x - w / 2, "start": x, "end": x - w}[flow.anchor]
            top = y + i * 15 - 10
            boxes.append((left, top, w, 13))
        return boxes

    def container_fill(self, x, y, theme):
        """Fill behind a point: the innermost band/app containing it, else the page."""
        fill, area = theme["bg"], None
        fills = {"band": "lane", "app": "app_fill", "stage": "stage_fill", "bar": "bar_fill",
                 "subscription": "sub_fill"}
        for g in self.groups:
            if g.style in fills and g.x <= x <= g.x + g.w and g.y <= y <= g.y + g.h:
                if area is None or g.w * g.h < area:
                    fill = theme[fills[g.style]]
                    area = g.w * g.h
        return fill

    # ----- validation -----------------------------------------------------
    def card_text(self, c):
        """(text, size, weight, mono, available width) for every line a card draws."""
        if c.role == "view":
            avail = c.w - 2 * 12
            return [(c.title, 14, 600, False, avail), (c.lines[0], 12, 400, False, avail)]
        if c.role == "note":
            avail = c.w - 2 * 16
            return [(c.title, 14, 600, False, avail), *[(l, BODY, 400, False, avail) for l in c.lines]]
        if c.role == "node":
            rows = [(l, c.font, 400, False, c.w) for l in c.lines]
            if c.caption:
                rows.append((c.caption, 11.5, 400, False, c.w))
            return rows
        if c.role == "row":
            mono = c.meta["kind"] == "res"
            weight = 400 if mono else 600
            return [(c.title, 12.5, weight, mono, c.meta["name_w"] - 8),
                    (c.lines[0], 12, 400, False, c.meta["purpose_w"] - 16)]
        left = PAD + ICON + ICON_GAP if c.icon else 16
        avail = c.w - left - PAD
        rows = [(c.title, TITLE, 600, False, avail), *[(l, BODY, 400, False, avail) for l in c.lines]]
        if c.service:
            rows.append((c.service, SERVICE, 400, True, avail))
        return rows

    def validate(self):
        errors = []
        ids = [x.id for x in (*self.cards, *self.groups, *self.flows)]
        dupes = {i for i in ids if ids.count(i) > 1}
        if dupes:
            errors.append(f"duplicate ids: {sorted(dupes)}")
        for c in self.cards:
            for text, size, weight, mono, avail in self.card_text(c):
                if text_width(text, size, weight, mono) > avail:
                    errors.append(f"{c.id}: text too wide for card: {text!r}")
            if c.role == "card":
                needed = TITLE_BASE + (FIRST_LINE - TITLE_BASE + LINE * (len(c.lines) - 1) if c.lines else 0) + (21 if c.service else 0) + 10
                if needed > c.h:
                    errors.append(f"{c.id}: card height {c.h} too small for its text ({needed})")
            if c.x < 0 or c.y < 0 or c.x + c.w > self.width or c.y + c.h > self.height:
                errors.append(f"{c.id}: outside the sheet")
            if c.parent:
                p = self.item(c.parent)
                if not (p.x <= c.x and p.y <= c.y and c.x + c.w <= p.x + p.w and c.y + c.h <= p.y + p.h):
                    errors.append(f"{c.id}: outside its parent {c.parent}")
            if c.icon and not c.icon.startswith("glyph:") and not (ASSETS / f"{c.icon}.svg").is_file():
                errors.append(f"{c.id}: missing icon {c.icon}")
            if c.icon and c.icon.startswith("glyph:") and c.icon[6:] not in GLYPHS:
                errors.append(f"{c.id}: unknown glyph {c.icon}")
        for i, a in enumerate(self.cards):
            for b in self.cards[i + 1:]:
                if a.x < b.x + b.w and b.x < a.x + a.w and a.y < b.y + b.h and b.y < a.y + a.h:
                    errors.append(f"cards overlap: {a.id} / {b.id}")
        for g in self.groups:
            if g.style in ("stage", "bar"):
                if text_width(g.title, 16) > g.w:
                    errors.append(f"{g.id}: title wider than the {g.style}")
                continue
            for text, size, weight in ((g.title, 15, 600),):
                room = g.w - 32 - (ICON - 6 + 10 if g.icon else 0)
                total = text_width(text, size, weight) + (text_width("  " + g.note, 13) if g.note else 0)
                if total > room:
                    errors.append(f"{g.id}: group title and note too wide ({total:.0f} > {room:.0f})")
        for f in self.flows:
            pts = f.points
            for a, b in zip(pts, pts[1:]):
                if a[0] != b[0] and a[1] != b[1]:
                    errors.append(f"{f.id}: diagonal segment {a} -> {b}")
                if a == b:
                    errors.append(f"{f.id}: zero-length segment at {a}")
            for end, item_id in ((pts[0], f.src), (pts[-1], f.dst)):
                if item_id is None:
                    continue
                b = self.item(item_id)
                rects = [(b.x, b.y, b.w, b.h)]
                if getattr(b, "role", None) == "node":
                    rects.append(b.icon_rect())
                if not any(_on_edge(end, r) for r in rects):
                    errors.append(f"{f.id}: endpoint {end} is not on the edge of {item_id}")
            related = {f.src, f.dst}
            for c in self.cards:
                if c.id in related or c.parent in related:
                    continue
                for a, b in zip(pts, pts[1:]):
                    if _segment_hits(a, b, (c.x + 1, c.y + 1, c.w - 2, c.h - 2)):
                        errors.append(f"{f.id}: crosses card {c.id}")
                        break
            for box in self.label_boxes(f):
                for c in self.cards:
                    if _boxes_overlap(box, (c.x, c.y, c.w, c.h)):
                        errors.append(f"{f.id}: label overlaps card {c.id}")
                if box[0] < 0 or box[0] + box[2] > self.width:
                    errors.append(f"{f.id}: label outside the sheet")
        for number, x, y in self.steps:
            box = (x - 12, y - 12, 24, 24)
            for c in self.cards:
                if _boxes_overlap(box, (c.x, c.y, c.w, c.h)):
                    errors.append(f"step {number} overlaps {c.id}")
            for f in self.flows:
                for lb in self.label_boxes(f):
                    if _boxes_overlap(box, lb):
                        errors.append(f"step {number} overlaps label of {f.id}")
        for kind, key, label, x, y, w in ([] if self.style == "learn" else self.legend_layout()):
            box = (x, y - 10, w, 16)
            for c in self.cards:
                if _boxes_overlap(box, (c.x, c.y, c.w, c.h)):
                    errors.append(f"legend entry {label!r} overlaps card {c.id}")
            for g in self.groups:
                if _boxes_overlap(box, (g.x, g.y, g.w, g.h)):
                    errors.append(f"legend entry {label!r} overlaps group {g.id}")
        labels = [(f.id, box) for f in self.flows for box in self.label_boxes(f)]
        for i, (fa, a) in enumerate(labels):
            for fb, b in labels[i + 1:]:
                if fa != fb and _boxes_overlap(a, b):
                    errors.append(f"labels overlap: {fa} / {fb}")
        segments = [(f.id, a, b) for f in self.flows for a, b in zip(f.points, f.points[1:])]
        for i, (fa, a1, a2) in enumerate(segments):
            for fb, b1, b2 in segments[i + 1:]:
                if fa != fb and _collinear_overlap(a1, a2, b1, b2):
                    errors.append(f"flows run on top of each other: {fa} / {fb}")
        if errors:
            raise ValueError(f"{self.name}:\n  " + "\n  ".join(errors))
        return True

    # ----- rendering ------------------------------------------------------
    def used_kinds(self):
        plain = lambda f: not (f.dashed and f.kind in ("data", "request"))
        kinds = [k for k in KINDS if any(f.kind == k and plain(f) for f in self.flows)]
        if any(not plain(f) for f in self.flows):
            kinds.append("dashed-data")
        return kinds

    # ----- learn-style legend (drawn under the sheet) -------------------------
    def learn_legend(self):
        """Legend entries actually used by this sheet, laid out in rows under the drawing."""
        items = []
        flows = self.flows
        if any(f.kind in ("data", "request") and not f.dashed and not f.both for f in flows):
            items.append(("arrow", "solid", "Data or call"))
        if any(f.both for f in flows):
            items.append(("arrow", "both", "Two-way exchange"))
        if any(f.dashed or f.kind in ("control", "audit") for f in flows):
            items.append(("arrow", "dashed", "Optional, gated, binding or diagnostic path"))
        if any(f.kind == "identity" for f in flows):
            items.append(("arrow", "dotted", "Identity or grant"))
        if any(isinstance(n, int) for n, _, _ in self.steps):
            items.append(("step", "step", "Workflow step; numbers match the article"))
        if any(isinstance(n, str) for n, _, _ in self.steps):
            items.append(("step", "area", "Design area; letters match the design guide"))
        if any(c.optional for c in self.cards):
            items.append(("box", "optional", "Optional component or add-on"))
        styles = {g.style for g in self.groups}
        if "stage" in styles:
            items.append(("box", "stage", "Stage"))
        if "zone" in styles:
            items.append(("box", "zone", "Platform, tenant or region"))
        if "subscription" in styles:
            items.append(("box", "subscription", "Subscription"))
        if any(g.style == "boundary" and not g.accent for g in self.groups):
            items.append(("box", "boundary", "Network, resource group or trust boundary"))
        if any(g.accent for g in self.groups):
            items.append(("box", "unit", "Scale unit (deployment stamp)"))
        placed, x, y = [], 40, self.height + 26
        for kind, key, label in items:
            w = (44 if kind == "arrow" else 32) + text_width(label, 12.5)
            if x > 40 and x + w > self.width - 40:
                x, y = 40, y + 26
            placed.append((kind, key, label, x, y))
            x += w + 30
        return placed

    def canvas_height(self):
        if self.style != "learn":
            return self.height
        placed = self.learn_legend()
        return (placed[-1][4] + 26) if placed else self.height

    def _render_learn_legend(self, t):
        out = []
        placed = self.learn_legend()
        if not placed:
            return out
        out.append(f'<path d="M40,{self.height + 4} H{self.width - 40}" stroke="{t["rule"]}" stroke-width="1"/>')
        for kind, key, label, x, y in placed:
            if kind == "arrow":
                dash = {"dashed": ' stroke-dasharray="6 4"', "dotted": ' stroke-dasharray="2 4" stroke-linecap="round"'}.get(key, "")
                start = ' marker-start="url(#arrow-ink)"' if key == "both" else ""
                out.append(f'<path d="M{x:g},{y:g} H{x + 34:g}" stroke="{t["arrow"]}" stroke-width="1.5" fill="none"'
                           f'{dash} marker-end="url(#arrow-ink)"{start}/>')
                tx = x + 44
            elif kind == "step":
                out.append(f'<circle cx="{x + 11:g}" cy="{y:g}" r="9" fill="{t["blue"]}"/>')
                out.append(_text(x + 11, y + 4, "A" if key == "area" else "1", 11, t["bg"], 700, "middle"))
                tx = x + 32
            else:
                style = {
                    "optional": f'fill="none" stroke="{t["neutral"]}" stroke-dasharray="4 3"',
                    "stage": f'fill="{t["stage_fill"]}" stroke="{t["blue"]}" stroke-dasharray="4 3"',
                    "zone": f'fill="none" stroke="{t["blue"]}" stroke-dasharray="1.5 3" stroke-linecap="round"',
                    "subscription": f'fill="{t["sub_fill"]}" stroke="{t["blue"]}"',
                    "boundary": f'fill="none" stroke="{t["boundary"]}"',
                    "unit": f'fill="none" stroke="{t["unit"]}" stroke-dasharray="6 3"',
                }[key]
                out.append(f'<rect x="{x:g}" y="{y - 8:g}" width="22" height="16" rx="3" stroke-width="1.3" {style}/>')
                tx = x + 32
            out.append(_text(tx, y + 4, label, 12.5, t["muted"]))
        return out

    def render(self, theme_name="light"):
        t = THEMES[theme_name]
        height = self.canvas_height()
        out = [
            f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
            f'viewBox="0 0 {self.width} {height}" width="{self.width}" height="{height}" '
            f'role="img" aria-labelledby="{self.name}-title {self.name}-desc">',
            f'<title id="{self.name}-title">{escape(self.title)}</title>',
            f'<desc id="{self.name}-desc">{escape(self.subtitle)}</desc>',
            "<defs>",
        ]
        for kind in KINDS:
            out.append(
                f'<marker id="arrow-{kind}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="10" '
                f'markerHeight="10" markerUnits="userSpaceOnUse" orient="auto-start-reverse">'
                f'<path d="M0,0.6 L10,5 L0,9.4 z" fill="{t[kind]}"/></marker>'
            )
        out.append(
            '<marker id="arrow-ink" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" '
            'markerHeight="9" markerUnits="userSpaceOnUse" orient="auto-start-reverse">'
            f'<path d="M0,0.8 L10,5 L0,9.2 z" fill="{t["arrow"]}"/></marker>'
        )
        icons = sorted({c.icon for c in self.cards if c.icon and not c.icon.startswith("glyph:")}
                       | {g.icon for g in self.groups if g.icon})
        for name in icons:
            out.append(
                f'<symbol id="icon-{name}" viewBox="0 0 1 1"><image width="1" height="1" '
                f'href="{icon_uri(name)}" xlink:href="{icon_uri(name)}"/></symbol>'
            )
        out.append("</defs>")
        out.append(f'<rect width="{self.width}" height="{height}" fill="{t["bg"]}"/>')
        out.append(f'<g font-family="{SANS}">')
        if self.style == "learn":
            out += [_text(40, 46, self.title, 24, t["ink"], 600), _text(40, 72, self.subtitle, 14, t["muted"])]
            out += self._render_learn_legend(t)
        else:
            out += self._render_header(t)
            out += self._render_legend(t)
        for style in ("band", "subscription", "stage", "zone", "bar", "app", "boundary"):
            for g in self.groups:
                if g.style == style:
                    out += self._render_group(g, t)
        for x, y, text, anchor in self.headers:
            if self.style == "learn":
                out.append(_text(x, y, text, 16, t["blue"], 400, anchor))
            else:
                out.append(_text(x, y, text.upper(), 12, t["faint"], 600, anchor, mono=True, spacing=1.4))
        for f in self.flows:
            out.append(self._render_flow(f, t))
        for c in self.cards:
            out += self._render_card(c, t)
        for f in self.flows:
            out += self._render_label(f, t)
        for number, x, y in self.steps:
            out.append(f'<circle cx="{x:g}" cy="{y:g}" r="11" fill="{t["blue"]}" stroke="{t["bg"]}" stroke-width="2"/>')
            out.append(_text(x, y + 4.5, str(number), 12.5, t["bg"], 700, "middle"))
        if self.footnote:
            out.append(_text(40, self.height - 22, self.footnote, 12.5, t["muted"]))
        out.append("</g></svg>")
        return "\n".join(out) + "\n"

    def _render_header(self, t):
        return [
            _text(40, 44, self.eyebrow.upper(), 13, t["faint"], 600, mono=True, spacing=1.6),
            _text(40, 80, self.title, 28, t["ink"], 600),
            _text(40, 108, self.subtitle, 15, t["muted"]),
        ]

    def legend_layout(self):
        """Legend entries as (type, key, label, x, y, width), wrapped to legend_width."""
        x0, y0 = self.legend_at
        limit = x0 + (self.legend_width or self.width - 2 * x0)
        entries = [("flow", k, LEGEND[k], 44) for k in self.used_kinds()]
        platforms = [p for p in PLATFORMS if any(c.platform == p and c.role == "card" for c in self.cards)]
        swatches = [("platform", p, PLATFORMS[p], 30) for p in platforms]
        if any(c.optional for c in self.cards):
            swatches.append(("optional", "optional", "Optional or enterprise addition", 30))
        placed, y = [], y0
        for group in (entries, swatches):
            cursor = x0
            for kind, key, label, lead in group:
                w = lead + text_width(label, 13)
                if cursor > x0 and cursor + w > limit:
                    cursor, y = x0, y + 26
                placed.append((kind, key, label, cursor, y, w))
                cursor += w + 28
            y += 26
        return placed

    def _render_legend(self, t):
        out = []
        for kind, key, label, x, y, w in self.legend_layout():
            if kind == "flow":
                base = "data" if key == "dashed-data" else key
                dash = DASH.get(base, "9 6" if key == "dashed-data" else None)
                attrs = f' stroke-dasharray="{dash}"' if dash else ""
                cap = ' stroke-linecap="round"' if base == "identity" else ""
                out.append(
                    f'<path d="M{x:g},{y:g} H{x + 34:g}" stroke="{t[base]}" stroke-width="2"{attrs}{cap} '
                    f'fill="none" marker-end="url(#arrow-{base})"/>'
                )
                out.append(_text(x + 44, y + 4, label, 13, t["muted"]))
            elif kind == "platform":
                out.append(f'<rect x="{x:g}" y="{y - 8:g}" width="22" height="14" rx="3" fill="{t[key + "_fill"]}" stroke="{t[key]}" stroke-width="1.2"/>')
                out.append(_text(x + 30, y + 4, label, 13, t["muted"]))
            else:
                out.append(f'<rect x="{x:g}" y="{y - 8:g}" width="22" height="14" rx="3" fill="none" stroke="{t["neutral"]}" stroke-width="1.2" stroke-dasharray="4 3"/>')
                out.append(_text(x + 30, y + 4, label, 13, t["muted"]))
        return out

    def _render_group(self, g, t):
        out = []
        if g.style == "stage":
            out.append(f'<rect x="{g.x}" y="{g.y}" width="{g.w}" height="{g.h}" rx="4" fill="{t["stage_fill"]}" '
                       f'stroke="{t["blue"]}" stroke-width="1.3" stroke-dasharray="7 4"/>')
            if g.title:
                out.append(_text(g.x + g.w / 2, g.y - 12, g.title, 16, t["blue"], 400, "middle"))
            return out
        if g.style in ("zone", "subscription"):
            if g.style == "zone":
                out.append(f'<rect x="{g.x}" y="{g.y}" width="{g.w}" height="{g.h}" rx="6" fill="none" '
                           f'stroke="{t["blue"]}" stroke-width="1.5" stroke-dasharray="1.5 4" stroke-linecap="round"/>')
            else:
                out.append(f'<rect x="{g.x}" y="{g.y}" width="{g.w}" height="{g.h}" rx="6" fill="{t["sub_fill"]}" '
                           f'stroke="{t["blue"]}" stroke-width="1.2"/>')
            tx = g.x + 16
            if g.icon:
                out.append(_use(g.icon, g.x + 14, g.y + 10, 26))
                tx = g.x + 48
            title = escape(g.title)
            note = (f'<tspan font-size="13" font-weight="400" fill="{t["muted"]}" dx="10">{escape(g.note)}</tspan>'
                    if g.note and g.style == "subscription" else "")
            out.append(f'<text x="{tx:g}" y="{g.y + 29:g}" font-size="15" font-weight="600" fill="{t["ink"]}">{title}{note}</text>')
            return out
        if g.style == "bar":
            out.append(f'<rect x="{g.x}" y="{g.y}" width="{g.w}" height="{g.h}" rx="4" fill="{t["bar_fill"]}" '
                       f'stroke="{t["arrow"]}" stroke-width="1"/>')
            if g.note == "left":
                out.append(_text(g.x + 16, g.y + g.h / 2 + 5, g.title, 14, t["ink"], 600))
            else:
                width = text_width(g.title, 14)
                cx = g.x + g.w / 2 - (12 if g.icon else 0)
                out.append(_text(cx, g.y + g.h / 2 + 5, g.title, 14, t["ink"], 400, "middle"))
                if g.icon:
                    out.append(_use(g.icon, cx + width / 2 + 8, g.y + g.h / 2 - 10, 20))
            return out
        if g.style == "band":
            out.append(f'<rect x="{g.x}" y="{g.y}" width="{g.w}" height="{g.h}" rx="12" fill="{t["lane"]}"/>')
        elif g.style == "app":
            out.append(f'<rect x="{g.x}" y="{g.y}" width="{g.w}" height="{g.h}" rx="14" fill="{t["app_fill"]}" stroke="{t["azure"]}" stroke-width="1.5"/>')
        else:
            dash = ' stroke-dasharray="8 6"' if g.dashed else ""
            stroke = t["unit"] if g.accent else t["boundary"]
            out.append(f'<rect x="{g.x}" y="{g.y}" width="{g.w}" height="{g.h}" rx="12" fill="none" stroke="{stroke}" stroke-width="1.5"{dash}/>')
            if g.accent:  # scale unit: title in the accent colour, no icon
                out.append(_text(g.x + 16, g.y + 26, g.title, 15, t["unit"], 600))
                if g.note:
                    out.append(_text(g.x + 16 + text_width(g.title, 15, 600) + 10, g.y + 26, g.note, 13, t["muted"]))
                return out
        tx = g.x + 16
        if g.icon:
            out.append(_use(g.icon, g.x + 14, g.y + 10, ICON - 6))
            tx += ICON - 6 + 10 - 2
        ty = g.y + 26
        title = escape(g.title)
        note = f'<tspan font-size="13" font-weight="400" fill="{t["muted"]}" dx="10">{escape(g.note)}</tspan>' if g.note else ""
        out.append(f'<text x="{tx}" y="{ty}" font-size="15" font-weight="600" fill="{t["ink"]}">{title}{note}</text>')
        return out

    def _render_flow(self, f, t):
        d = "M" + " L".join(f"{x:g},{y:g}" for x, y in f.points)
        learn = self.style == "learn"
        if learn:
            dash = {"control": "6 4", "identity": "2 4", "audit": "6 4"}.get(f.kind) or ("6 4" if f.dashed else None)
        else:
            dash = DASH.get(f.kind) or ("9 6" if f.dashed else None)
        attrs = f' stroke-dasharray="{dash}"' if dash else ""
        if f.kind == "identity":
            attrs += ' stroke-linecap="round"'
        marker = "ink" if learn else f.kind
        color = t["arrow"] if learn else t[f.kind]
        width = 1.5 if learn else 2
        start = f' marker-start="url(#arrow-{marker})"' if f.both else ""
        return (f'<path id="flow-{f.id}" d="{d}" fill="none" stroke="{color}" stroke-width="{width}" '
                f'stroke-linejoin="round"{attrs} marker-end="url(#arrow-{marker})"{start}/>')

    def _render_label(self, f, t):
        out = []
        if f.label is None:
            return out
        x, y = f.at
        halo = self.container_fill(x, y - 4, t)
        learn = self.style == "learn"
        for i, line in enumerate(self.label_lines(f)):
            weight = 400 if learn else 600
            color = t["muted"] if learn else t[f.kind]
            out.append(
                f'<text x="{x:g}" y="{y + i * 15:g}" font-size="{LABEL}" font-weight="{weight}" fill="{color}" '
                f'text-anchor="{f.anchor}" stroke="{halo}" stroke-width="4" stroke-linejoin="round" '
                f'paint-order="stroke">{escape(line)}</text>'
            )
        return out

    def _render_card(self, c, t):
        out = []
        if c.role == "node":
            ix, iy, s, _ = c.icon_rect()
            if c.optional:
                out.append(f'<rect x="{c.x - 6:g}" y="{c.y - 8:g}" width="{c.w + 12:g}" height="{c.h + 14:g}" rx="8" '
                           f'fill="none" stroke="{t["neutral"]}" stroke-width="1.2" stroke-dasharray="5 4"/>')
            if c.icon and c.icon.startswith("glyph:"):
                out.append(_glyph(c.icon[6:], ix, iy, s, t["ink"]))
            elif c.icon:
                out.append(_use(c.icon, ix, iy, s))
            cx = c.x + c.w / 2
            base = iy + s + c.font + 4
            for i, line in enumerate(c.lines):
                base = iy + s + c.font + 4 + i * (c.font + 3)
                out.append(_text(cx, base, line, c.font, t["ink"], 400, "middle"))
            if c.caption:
                out.append(_text(cx, base + 15, c.caption, 11.5, t["muted"], 400, "middle"))
            return out
        if c.role == "row":
            kind, nw, pw = c.meta["kind"], c.meta["name_w"], c.meta["purpose_w"]
            s = c.icon_size
            if c.icon:
                out.append(_use(c.icon, c.x + (26 - s) / 2, c.y + (c.h - s) / 2, s))
            nx = c.x + 34
            if kind == "res":
                out.append(_text(nx, c.y + 18, c.title, 12.5, t["ink"], mono=True))
            else:
                out.append(_text(nx, c.y + 18, c.title, 13, t["ink"], 600))
            px = nx + nw
            pill = {"sub": "pill_sub", "rg": "pill_rg", "res": "pill_res"}[kind]
            out.append(f'<rect x="{px:g}" y="{c.y + 3:g}" width="{pw - 4:g}" height="{c.h - 6:g}" rx="3" fill="{t[pill]}"/>')
            out.append(_text(px + 8, c.y + 18, c.lines[0], 12, t["ink"]))
            return out
        if c.role == "view":
            out.append(f'<rect x="{c.x}" y="{c.y}" width="{c.w}" height="{c.h}" rx="8" fill="{t["neutral_fill"]}" stroke="{t["rule"]}" stroke-width="1.2"/>')
            out.append(_text(c.x + 12, c.y + 23, c.title, 14, t["ink"], 600))
            out.append(_text(c.x + 12, c.y + 42, c.lines[0], 12, t["muted"]))
            return out
        if c.role == "note":
            out.append(f'<rect x="{c.x}" y="{c.y}" width="{c.w}" height="{c.h}" rx="10" fill="{t["bg"]}" stroke="{t["rule"]}" stroke-width="1.2"/>')
            out.append(_text(c.x + 16, c.y + 28, c.title, 14, t["ink"], 600))
            for i, line in enumerate(c.lines):
                out.append(_text(c.x + 16, c.y + 50 + i * LINE, line, BODY, t["muted"]))
            return out
        dash = ' stroke-dasharray="6 4"' if c.optional else ""
        out.append(
            f'<rect x="{c.x}" y="{c.y}" width="{c.w}" height="{c.h}" rx="10" fill="{t[c.platform + "_fill"]}" '
            f'stroke="{t[c.platform]}" stroke-width="1.3"{dash}/>'
        )
        tx = c.x + 16
        if c.icon:
            if c.icon.startswith("glyph:"):
                out.append(_glyph(c.icon[6:], c.x + PAD, c.y + PAD, ICON, t[c.platform]))
            else:
                out.append(_use(c.icon, c.x + PAD, c.y + PAD, ICON))
            tx = c.x + PAD + ICON + ICON_GAP
        out.append(_text(tx, c.y + TITLE_BASE, c.title, TITLE, t["ink"], 600))
        base = c.y + TITLE_BASE
        for i, line in enumerate(c.lines):
            base = c.y + FIRST_LINE + i * LINE
            out.append(_text(tx, base, line, BODY, t["muted"]))
        if c.service:
            out.append(_text(tx, base + 21, c.service, SERVICE, t[c.platform], mono=True))
        return out


# ----- module helpers -------------------------------------------------------
def _text(x, y, text, size, fill, weight=400, anchor="start", mono=False, spacing=None):
    family = f' font-family="{MONO}" font-variant-ligatures="none"' if mono else ""
    weight_attr = f' font-weight="{weight}"' if weight != 400 else ""
    anchor_attr = f' text-anchor="{anchor}"' if anchor != "start" else ""
    spacing_attr = f' letter-spacing="{spacing}"' if spacing else ""
    return (f'<text x="{x:g}" y="{y:g}" font-size="{size}" fill="{fill}"{weight_attr}{anchor_attr}'
            f'{family}{spacing_attr}>{escape(text)}</text>')


def _use(name, x, y, size):
    return (f'<use href="#icon-{name}" xlink:href="#icon-{name}" x="{x:g}" y="{y:g}" '
            f'width="{size}" height="{size}"/>')


def _glyph(name, x, y, size, color):
    """Plain pictograms for customer and third-party sources (no product branding)."""
    s = size / 30
    p = {
        "database": "M5,8 C5,4 25,4 25,8 V22 C25,26 5,26 5,22 Z M5,8 C5,12 25,12 25,8 M5,15 C5,19 25,19 25,15",
        "globe": "M15,4 A11,11 0 1 0 15.01,4 Z M4,15 H26 M15,4 C9,9 9,21 15,26 M15,4 C21,9 21,21 15,26",
        "document": "M8,4 H19 L24,9 V26 H8 Z M19,4 V9 H24 M11,14 H21 M11,18 H21 M11,22 H17",
        "gauge": "M4,21 A11,11 0 1 1 26,21 M15,21 L21,11 M8,21 H22",
        "network": "M15,5 V11 M7,19 V15 H23 V19 M15,11 V15 M11,5 H19 V11 H11 Z M3,19 H11 V25 H3 Z M19,19 H27 V25 H19 Z",
        "shield": "M15,4 L25,8 V15 C25,21 20,25 15,27 C10,25 5,21 5,15 V8 Z M10,15 L14,19 L20,12",
        "clock": "M15,4 A11,11 0 1 0 15.01,4 Z M15,9 V15 L20,18",
        "window": "M4,6 H26 V24 H4 Z M4,11 H26 M7,8.5 H8 M10,8.5 H11 M8,15 H18 M8,19 H22",
        "api": "M11,6 C7,6 9,15 5,15 C9,15 7,24 11,24 M19,6 C23,6 21,15 25,15 C21,15 23,24 19,24",
        "chat": "M5,7 H25 V20 H14 L9,25 V20 H5 Z M10,12 H20 M10,16 H17",
    }[name]
    return (f'<g transform="translate({x:g},{y:g}) scale({s:g})" fill="none" stroke="{color}" '
            f'stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="{p}"/></g>')


_ICON_CACHE = {}


def icon_uri(name):
    if name not in _ICON_CACHE:
        raw = (ASSETS / f"{name}.svg").read_text(encoding="utf-8")
        head = re.match(r"\s*(<\?xml[^>]*>\s*)?<svg\b[^>]*>", raw)
        tag = head.group(0) if head else ""
        if tag and "viewBox" not in tag:
            w = re.search(r'\bwidth="([\d.]+)', tag)
            h = re.search(r'\bheight="([\d.]+)', tag)
            if w and h:
                raw = raw.replace(tag, tag[:-1] + f' viewBox="0 0 {w.group(1)} {h.group(1)}">', 1)
        _ICON_CACHE[name] = "data:image/svg+xml;base64," + base64.b64encode(raw.encode("utf-8")).decode("ascii")
    return _ICON_CACHE[name]


def verify_icons():
    """Fail if any official icon differs from the hash recorded in the manifest."""
    manifest = json.loads((ASSETS / "manifest.json").read_text(encoding="utf-8"))
    for name, meta in manifest["icons"].items():
        digest = sha256((ASSETS / name).read_bytes()).hexdigest()
        if digest != meta["sha256"]:
            raise ValueError(f"Official icon changed: {name}")
    return manifest


def _icon_style_uri(sheet_icon, theme):
    """draw.io wants image=data:image/svg+xml,<base64> (no ';base64', since ';' separates styles)."""
    if sheet_icon.startswith("glyph:"):
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30" width="30" height="30">'
               f'{_glyph(sheet_icon[6:], 0, 0, 30, theme["ink"])}</svg>')
        data = base64.b64encode(svg.encode("utf-8")).decode("ascii")
    else:
        data = icon_uri(sheet_icon).split(",", 1)[1]
    return "data:image/svg+xml," + data


def drawio_document(sheets, theme_name="light"):
    """One editable draw.io page per sheet: containers, official icons with labels, connected
    edges with the same waypoints, numbered steps and text. Built from the same sheet data."""
    import xml.etree.ElementTree as ET

    t = THEMES[theme_name]
    root = ET.Element("mxfile", {"host": "OneGrid diagram builder", "type": "device", "compressed": "false"})
    for s in sheets:
        diagram = ET.SubElement(root, "diagram", {"id": s.name, "name": s.title})
        model = ET.SubElement(diagram, "mxGraphModel", {
            "grid": "0", "gridSize": "10", "guides": "1", "tooltips": "1", "connect": "1", "arrows": "1",
            "fold": "1", "page": "1", "pageScale": "1", "pageWidth": str(s.width),
            "pageHeight": str(s.canvas_height()), "math": "0", "shadow": "0", "background": t["bg"]})
        cells = ET.SubElement(model, "root")
        ET.SubElement(cells, "mxCell", {"id": "0"})
        ET.SubElement(cells, "mxCell", {"id": "1", "parent": "0"})
        ids = set()

        def cid(name):
            value = f"{s.name}:{name}"
            while value in ids:
                value += "+"
            ids.add(value)
            return value

        def vertex(name, value, style, x, y, w, h):
            cell = ET.SubElement(cells, "mxCell", {"id": cid(name), "value": value, "style": style,
                                                   "vertex": "1", "parent": "1"})
            ET.SubElement(cell, "mxGeometry", {"x": f"{x:g}", "y": f"{y:g}", "width": f"{w:g}",
                                               "height": f"{h:g}", "as": "geometry"})
            return cell.get("id")

        def text(name, value, x, y, w, h, size, color, bold=False, align="left"):
            style = (f"text;html=1;strokeColor=none;fillColor=none;align={align};verticalAlign=middle;"
                     f"whiteSpace=nowrap;fontSize={size:g};fontColor={color};fontStyle={1 if bold else 0};")
            return vertex(name, value, style, x, y, w, h)

        def image(name, icon, x, y, size, value="", extra=""):
            style = (f"shape=image;html=1;imageAspect=1;aspect=fixed;verticalLabelPosition=bottom;"
                     f"verticalAlign=top;labelPosition=center;align=center;{extra}"
                     f"image={_icon_style_uri(icon, t)};")
            return vertex(name, value, style, x, y, size, size)

        text("title", escape(s.title), 40, 26, s.width - 80, 30, 24, t["ink"], True)
        text("subtitle", escape(s.subtitle), 40, 58, s.width - 80, 22, 14, t["muted"])
        cell_of = {}
        for g in s.groups:
            if g.style == "stage":
                style = (f"rounded=1;arcSize=2;html=1;fillColor={t['stage_fill']};strokeColor={t['blue']};"
                         f"dashed=1;dashPattern=7 4;verticalLabelPosition=top;verticalAlign=bottom;"
                         f"labelPosition=center;align=center;fontSize=16;fontColor={t['blue']};")
                cell_of[g.id] = vertex(g.id, escape(g.title), style, g.x, g.y, g.w, g.h)
                continue
            if g.style == "bar":
                align = "left" if g.note == "left" else "center"
                style = (f"rounded=1;arcSize=6;html=1;fillColor={t['bar_fill']};strokeColor={t['arrow']};"
                         f"align={align};verticalAlign=middle;spacingLeft=16;fontSize=14;fontColor={t['ink']};"
                         f"fontStyle={1 if align == 'left' else 0};")
                cell_of[g.id] = vertex(g.id, escape(g.title), style, g.x, g.y, g.w, g.h)
                continue
            if g.style == "zone":
                look = f"fillColor=none;strokeColor={t['blue']};dashed=1;dashPattern=1 4;"
            elif g.style == "subscription":
                look = f"fillColor={t['sub_fill']};strokeColor={t['blue']};"
            elif g.style == "band":
                look = f"fillColor={t['lane']};strokeColor=none;"
            elif g.style == "app":
                look = f"fillColor={t['app_fill']};strokeColor={t['azure']};"
            else:
                look = (f"fillColor=none;strokeColor={t['unit'] if g.accent else t['boundary']};"
                        + ("dashed=1;dashPattern=8 6;" if g.dashed else ""))
            pad = 48 if g.icon and not g.accent else 16
            value = f"<b>{escape(g.title)}</b>"
            if g.note and g.style not in ("bar",):
                value += f"&nbsp;&nbsp;<span style=\"font-weight:normal;color:{t['muted']};font-size:13px\">{escape(g.note)}</span>"
            style = (f"rounded=1;arcSize=2;html=1;{look}align=left;verticalAlign=top;spacingLeft={pad};"
                     f"spacingTop=8;fontSize=15;fontColor={t['unit'] if g.accent else t['ink']};strokeWidth=1.5;")
            cell_of[g.id] = vertex(g.id, value, style, g.x, g.y, g.w, g.h)
            if g.icon and not g.accent:
                image(g.id + "-icon", g.icon, g.x + 14, g.y + 10, 26)
        for x, y, label, anchor in s.headers:
            text(f"header-{label}", escape(label), x - 150, y - 16, 300, 22, 16, t["blue"], align="center")
        for c in s.cards:
            if c.role == "node":
                ix, iy, size, _ = c.icon_rect()
                if c.optional:
                    vertex(c.id + "-optional", "", f"rounded=1;html=1;fillColor=none;strokeColor={t['neutral']};"
                           f"dashed=1;dashPattern=5 4;", c.x - 6, c.y - 8, c.w + 12, c.h + 14)
                value = "<br>".join(escape(l) for l in c.lines)
                if c.caption:
                    value += f"<br><span style=\"font-size:11px;color:{t['muted']}\">{escape(c.caption)}</span>"
                if c.icon:
                    cell_of[c.id] = image(c.id, c.icon, ix, iy, size, value,
                                          f"fontSize={c.font:g};fontColor={t['ink']};spacingTop=-2;")
                else:
                    cell_of[c.id] = text(c.id, value, c.x, c.y, c.w, c.h, c.font, t["ink"], align="center")
            elif c.role == "row":
                if c.icon:
                    image(c.id + "-icon", c.icon, c.x + (26 - c.icon_size) / 2, c.y + (c.h - c.icon_size) / 2, c.icon_size)
                text(c.id + "-name", escape(c.title), c.x + 34, c.y, c.meta["name_w"], c.h, 12.5, t["ink"],
                     c.meta["kind"] != "res")
                pill = {"sub": "pill_sub", "rg": "pill_rg", "res": "pill_res"}[c.meta["kind"]]
                vertex(c.id + "-purpose", escape(c.lines[0]),
                       f"rounded=1;arcSize=10;html=1;fillColor={t[pill]};strokeColor=none;align=left;spacingLeft=8;"
                       f"fontSize=12;fontColor={t['ink']};", c.x + 34 + c.meta["name_w"], c.y + 3, c.meta["purpose_w"] - 4, c.h - 6)
            else:
                body = "<br>".join(escape(l) for l in c.lines)
                value = f"<b>{escape(c.title)}</b>" + (f"<br>{body}" if body else "")
                cell_of[c.id] = vertex(c.id, value, f"rounded=1;html=1;whiteSpace=wrap;align=left;verticalAlign=top;"
                                       f"spacing=12;fillColor={t['neutral_fill']};strokeColor={t['rule']};fontSize=13;",
                                       c.x, c.y, c.w, c.h)
        for f in s.flows:
            dash = {"control": "dashed=1;dashPattern=6 4;", "audit": "dashed=1;dashPattern=6 4;",
                    "identity": "dashed=1;dashPattern=2 4;"}.get(f.kind, "dashed=1;dashPattern=6 4;" if f.dashed else "")
            start = "startArrow=block;startFill=1;" if f.both else "startArrow=none;"
            style = (f"edgeStyle=none;html=1;rounded=0;endArrow=block;endFill=1;{start}{dash}"
                     f"strokeColor={t['arrow']};strokeWidth=1.5;")
            attrs = {"id": cid("flow-" + f.id), "style": style, "edge": "1", "parent": "1"}
            if f.src in cell_of:
                attrs["source"] = cell_of[f.src]
            if f.dst in cell_of:
                attrs["target"] = cell_of[f.dst]
            edge = ET.SubElement(cells, "mxCell", attrs)
            geometry = ET.SubElement(edge, "mxGeometry", {"relative": "1", "as": "geometry"})
            (x1, y1), (x2, y2) = f.points[0], f.points[-1]
            ET.SubElement(geometry, "mxPoint", {"x": f"{x1:g}", "y": f"{y1:g}", "as": "sourcePoint"})
            ET.SubElement(geometry, "mxPoint", {"x": f"{x2:g}", "y": f"{y2:g}", "as": "targetPoint"})
            if len(f.points) > 2:
                points = ET.SubElement(geometry, "Array", {"as": "points"})
                for x, y in f.points[1:-1]:
                    ET.SubElement(points, "mxPoint", {"x": f"{x:g}", "y": f"{y:g}"})
            if f.label is not None:
                x, y = f.at
                for i, line in enumerate(s.label_lines(f)):
                    w = text_width(line, LABEL) + 8
                    left = {"middle": x - w / 2, "start": x, "end": x - w}[f.anchor]
                    text(f"label-{f.id}-{i}", escape(line), left, y + i * 15 - 12, w, 16, LABEL, t["muted"],
                         align={"middle": "center", "start": "left", "end": "right"}[f.anchor])
        for number, x, y in s.steps:
            vertex(f"step-{number}", str(number), f"ellipse;html=1;fillColor={t['blue']};strokeColor=#FFFFFF;"
                   f"strokeWidth=2;fontColor=#FFFFFF;fontStyle=1;fontSize=12;", x - 11, y - 11, 22, 22)
        if s.footnote:
            text("footnote", escape(s.footnote), 40, s.height - 34, s.width - 80, 18, 12.5, t["muted"])
    ET.indent(root)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True) + b"\n"


def _on_edge(point, rect):
    x, y, w, h = rect
    px, py = point
    inside = x - 0.6 <= px <= x + w + 0.6 and y - 0.6 <= py <= y + h + 0.6
    on_x = abs(px - x) < 0.6 or abs(px - (x + w)) < 0.6
    on_y = abs(py - y) < 0.6 or abs(py - (y + h)) < 0.6
    return inside and (on_x or on_y)


def _segment_hits(a, b, rect):
    x, y, w, h = rect
    if a[1] == b[1]:
        lo, hi = sorted((a[0], b[0]))
        return y < a[1] < y + h and max(lo, x) < min(hi, x + w)
    lo, hi = sorted((a[1], b[1]))
    return x < a[0] < x + w and max(lo, y) < min(hi, y + h)


def _boxes_overlap(a, b):
    return a[0] < b[0] + b[2] and b[0] < a[0] + a[2] and a[1] < b[1] + b[3] and b[1] < a[1] + a[3]


def _collinear_overlap(a1, a2, b1, b2):
    if a1[1] == a2[1] == b1[1] == b2[1]:
        lo1, hi1 = sorted((a1[0], a2[0]))
        lo2, hi2 = sorted((b1[0], b2[0]))
        return min(hi1, hi2) - max(lo1, lo2) > 1
    if a1[0] == a2[0] == b1[0] == b2[0]:
        lo1, hi1 = sorted((a1[1], a2[1]))
        lo2, hi2 = sorted((b1[1], b2[1]))
        return min(hi1, hi2) - max(lo1, lo2) > 1
    return False
