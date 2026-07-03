# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "fastapi>=0.110",
#   "uvicorn>=0.29",
#   "jinja2>=3",
#   "pyyaml>=6",
#   "markdown-it-py>=3",
#   "python-multipart>=0.0.9",
# ]
# ///
"""orchestration console web app.

A tiny dashboard over the console files: project overview, the decisions that need you
(with full context + an answer box), the running tasks / sub-agents, and a live feed of
what's new. Read is a view; writeback is limited to user intent (answer a decision, post
a note). The agent stays the only writer of work state.

    uv run console_web.py --root <dir> --host 0.0.0.0 --port 8799

Set CONSOLE_TOKEN to require ?token=... (stored in a cookie after the first hit) for both
read and writeback, so it can be exposed off this machine.
"""

from __future__ import annotations

import argparse
import base64
import os
import sys
from pathlib import Path

from fastapi import FastAPI, Form, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from jinja2 import DictLoader, Environment, select_autoescape
from markdown_it import MarkdownIt

sys.path.insert(0, str(Path(__file__).resolve().parent))
from console_store import Store, _section_text, parse_messages  # noqa: E402

ROOT = os.environ.get("CONSOLE_ROOT", "docs/design/agent-workflows/scratch/console")
TOKEN = os.environ.get("CONSOLE_TOKEN", "")

# breaks=True so single newlines in a message become <br> (chat-style), linkify bare URLs
md = MarkdownIt("commonmark", {"breaks": True, "linkify": True, "html": False})
app = FastAPI(title="orchestration console")


def store() -> Store:
    return Store(ROOT)


# --- templates ---------------------------------------------------------------

BASE_CSS = """
:root{
  --bg:#f5f6f8; --card:#ffffff; --text:#171a21; --dim:#606a79; --line:#e4e7ec;
  --accent:#2563eb; --accent-ink:#ffffff; --chip:#eef1f5;
  --shadow:0 1px 2px rgba(16,24,40,.05), 0 1px 3px rgba(16,24,40,.04);
  --st-blue:#1d4ed8; --st-green:#15803d; --st-amber:#b45309; --st-red:#b42318;
  --tint-blue:rgba(37,99,235,.10); --tint-green:rgba(21,128,61,.11);
  --tint-amber:rgba(180,83,9,.12); --tint-red:rgba(180,35,24,.10); --new:#b45309;
}
:root[data-theme=dark]{
  --bg:#0e1116; --card:#161a21; --text:#e7eaf0; --dim:#98a2b3; --line:#242a34;
  --accent:#5b9dff; --accent-ink:#07122a; --chip:#1d232d; --shadow:none;
  --st-blue:#8fb8ff; --st-green:#79dda0; --st-amber:#f4c56b; --st-red:#ff9d95;
  --tint-blue:rgba(91,157,255,.16); --tint-green:rgba(60,180,110,.17);
  --tint-amber:rgba(240,170,70,.16); --tint-red:rgba(255,110,100,.15); --new:#f4c56b;
}
*{box-sizing:border-box}
html{color-scheme:light dark}
body{margin:0;background:var(--bg);color:var(--text);
  font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  -webkit-font-smoothing:antialiased;transition:background .15s,color .15s}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
.wrap{max-width:840px;margin:0 auto;padding:16px 20px 80px}
h1{font-size:21px;font-weight:650;margin:0 0 2px;letter-spacing:-.01em}
h2{font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.07em;
  color:var(--dim);margin:26px 0 8px}
.goal{color:var(--dim);margin:0 0 10px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;
  padding:14px 16px;margin:10px 0;box-shadow:var(--shadow)}
.pill{display:inline-flex;align-items:center;background:var(--chip);border-radius:999px;
  padding:2px 10px;font-size:12px;font-weight:500;color:var(--dim);margin-left:6px}
.pill.running,.pill.investigating,.pill.doing{color:var(--st-blue);background:var(--tint-blue)}
.pill.blocked,.pill.dropped{color:var(--st-red);background:var(--tint-red)}
.pill.done,.pill.locked,.pill.resolved{color:var(--st-green);background:var(--tint-green)}
.pill.in-review,.pill.open,.pill.queued,.pill.answered,.pill.promoted,.pill.waiting,.pill.task{
  color:var(--st-amber);background:var(--tint-amber)}
.needs{border-left:3px solid var(--st-amber)}
.muted{color:var(--dim);font-size:13px}
.body{margin-top:10px;padding-top:10px;border-top:1px solid var(--line);font-size:14.5px}
.body h1{font-size:15px;font-weight:650}
.body h2{font-size:13px;color:var(--text);text-transform:none;letter-spacing:0;
  margin:12px 0 4px;font-weight:600}
.body ul{padding-left:18px;margin:6px 0}.body p{margin:6px 0}
.body code{background:var(--chip);padding:1px 5px;border-radius:5px;font-size:13px}
textarea,input{width:100%;background:var(--bg);color:var(--text);border:1px solid var(--line);
  border-radius:8px;padding:9px 11px;font:inherit;font-size:14px}
textarea{min-height:56px;resize:vertical}
textarea:focus,input:focus{outline:none;border-color:var(--accent)}
button{background:var(--accent);color:var(--accent-ink);border:0;border-radius:8px;
  padding:8px 14px;font-weight:600;font-size:14px;cursor:pointer;margin-top:8px}
button:hover{filter:brightness(1.05)}
button.secondary{background:var(--chip);color:var(--text);border:1px solid var(--line)}
form button{margin-right:6px}
.feed{list-style:none;padding:0;margin:8px 0 0}
.feed li{padding:7px 2px;border-bottom:1px solid var(--line);display:flex;gap:12px;font-size:14px}
.feed li:last-child{border-bottom:0}
.feed .t{color:var(--dim);font-size:12px;white-space:nowrap;font-variant-numeric:tabular-nums}
.feed .new{color:var(--new);font-weight:500}
.badge{background:var(--tint-amber);color:var(--st-amber);border-radius:999px;
  padding:1px 8px;font-size:12px;font-weight:600}
details summary{cursor:pointer;color:var(--dim);font-size:13px;user-select:none}
.row{display:flex;justify-content:space-between;align-items:center;gap:10px}
.toolbar{position:sticky;top:0;z-index:5;background:var(--bg);padding:10px 0;margin-bottom:8px;
  border-bottom:1px solid var(--line);display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.toolbar button{margin:0;padding:6px 11px;font-size:13px}
.toolbar .sp{flex:1}
.wait{background:var(--tint-amber);color:var(--st-amber);border-radius:999px;padding:1px 9px;
  font-size:11px;font-weight:600;margin-right:6px}
.thead{cursor:pointer;display:flex;justify-content:space-between;align-items:center;
  gap:10px;font-weight:600}
.thead .caret{color:var(--dim);transition:transform .12s;font-size:11px}
.collapsed .tbody{display:none}.collapsed .caret{transform:rotate(-90deg)}
.card{scroll-margin-top:64px}
.code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;font-weight:700;
  letter-spacing:.02em;color:var(--st-blue);background:var(--tint-blue);
  border-radius:6px;padding:1px 6px;margin-right:2px;vertical-align:1px}
.summary{margin-top:10px;padding:10px 12px;background:var(--chip);border-radius:10px;
  font-size:14.5px}
.summary p:first-child{margin-top:0}.summary p:last-child{margin-bottom:0}
.msgs{margin-top:10px;display:flex;flex-direction:column;gap:8px}
.msg{border:1px solid var(--line);border-radius:10px;padding:8px 12px;background:var(--card)}
.msg.mine{background:var(--tint-blue);border-color:transparent}
.mh{font-size:11px;font-weight:600;color:var(--dim);margin-bottom:3px}
.mb{font-size:14.5px}.mb p{margin:5px 0}.mb p:first-child{margin-top:0}.mb p:last-child{margin-bottom:0}
.mb ul{margin:5px 0;padding-left:20px}.mb code{background:var(--chip);padding:1px 5px;border-radius:5px;font-size:13px}
.hidebtn{background:none;border:0;color:var(--dim);font-size:16px;line-height:1;cursor:pointer;
  padding:0 4px;margin:0}.hidebtn:hover{color:var(--st-red)}
.workbtn{background:none;border:0;color:var(--dim);font-size:14px;line-height:1;cursor:pointer;
  padding:0 4px;margin:0}.workbtn:hover{color:var(--accent)}
select{background:var(--bg);color:var(--text);border:1px solid var(--line);border-radius:8px;
  padding:9px 11px;font:inherit;font-size:14px;margin-top:8px}
.hiddencard{opacity:.6}
.hiddenlink{display:inline-block;margin:2px 0 8px;color:var(--dim);font-size:13px}
.hiddenlink:hover{color:var(--accent)}
.titlewrap{min-width:0;flex:1}
.preview{color:var(--dim);font-size:13px;margin-top:2px;white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis}
.card:not(.collapsed) .preview{display:none}
.hrow{display:flex;align-items:center;gap:4px;flex-shrink:0}
.hrow form{margin:0}
/* project switcher strip */
.strip{display:flex;gap:6px;overflow-x:auto;padding:2px 0 8px;margin-bottom:4px}
.chip{display:inline-flex;align-items:center;gap:6px;white-space:nowrap;flex-shrink:0;
  background:var(--card);border:1px solid var(--line);border-radius:999px;padding:4px 12px;
  font-size:13px;color:var(--text)}
.chip:hover{text-decoration:none;border-color:var(--accent)}
.chip.cur{background:var(--tint-blue);border-color:transparent;font-weight:600}
.d-needs,.d-new{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.d-needs{background:var(--st-amber)}.d-new{background:var(--st-blue)}
/* View dropdown menu */
.menu{position:relative;display:inline-block}
.menu>summary{list-style:none;display:inline-block;background:var(--chip);color:var(--text);
  border:1px solid var(--line);border-radius:8px;padding:6px 11px;font-size:13px;font-weight:600;
  cursor:pointer}
.menu>summary::-webkit-details-marker{display:none}
.menucontent{position:absolute;top:calc(100% + 4px);left:0;z-index:20;background:var(--card);
  border:1px solid var(--line);border-radius:10px;padding:6px;box-shadow:0 6px 20px rgba(0,0,0,.15);
  display:flex;flex-direction:column;gap:4px;min-width:150px}
.menucontent button{margin:0;text-align:left}
/* new-activity banner */
.banner{position:sticky;top:52px;z-index:6;background:var(--tint-amber);color:var(--st-amber);
  border:1px solid var(--line);border-radius:8px;padding:7px 12px;font-size:13px;font-weight:600;
  margin-bottom:8px}
.banner a{color:var(--accent)}
/* cross-project needs-you rows on home */
.needsrow{display:flex;align-items:center;gap:8px;color:var(--text);padding:12px 16px}
.needsrow:hover{text-decoration:none;border-color:var(--accent)}
.proj{font-size:12px;color:var(--dim);background:var(--chip);border-radius:6px;padding:1px 7px;
  flex-shrink:0}
"""

# runs before <body> paints, so there is no theme flash; also defines the toggle
THEME_JS = """<script>
(function(){
  function apply(t){document.documentElement.dataset.theme=t;
    var b=document.getElementById('themebtn');if(b)b.textContent=(t==='dark'?'\\u2600 Light':'\\u263e Dark');}
  var t=localStorage.getItem('console-theme')||
    (window.matchMedia&&matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light');
  document.documentElement.dataset.theme=t;
  window.toggleTheme=function(){t=(document.documentElement.dataset.theme==='dark')?'light':'dark';
    localStorage.setItem('console-theme',t);apply(t);};
  // collapse state persists across reloads (so posting/hiding does not re-expand everything)
  window.toggleCard=function(el){
    el.classList.toggle('collapsed');
    if(!el.id) return;
    try{var m=JSON.parse(localStorage.getItem('console-collapsed')||'{}');
      m[el.id]=el.classList.contains('collapsed');
      localStorage.setItem('console-collapsed',JSON.stringify(m));}catch(_){}
  };
  // hide/unhide in place via fetch: no reload, so scroll and collapse state are kept
  window.hideItem=function(btn, url){
    fetch(url,{method:'POST'}).then(function(r){
      if(!r.ok) return;
      var card=btn.closest('.card'); if(!card) return;
      var sec=(card.id||'').split('-')[0];
      var y=window.scrollY;
      card.parentNode.removeChild(card);
      window.scrollTo(0, y);  // keep the scroll position; never jump to the top
      if(url.indexOf('/hide?')>-1){
        var link=document.getElementById('hidelink-'+sec);
        if(link){var n=(parseInt(link.dataset.count||'0',10)||0)+1;
          link.dataset.count=n;link.textContent='Show '+n+' hidden';link.style.display='';}
      }
    }).catch(function(){});
  };
  // copy a paste-ready "work on this item" instruction (its file path) to hand to an agent
  window.workOn=function(btn, path){
    var text='Work on this console item using the work-on-item skill: '+path;
    var ok=function(){ if(btn){var o=btn.getAttribute('data-label')||btn.textContent;
      btn.textContent='copied \\u2713'; setTimeout(function(){btn.textContent=o},1400);} };
    if(navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(ok,function(){window.prompt('Copy this:',text)});
    } else { window.prompt('Copy this and paste into a Claude session:', text); }
  };
  document.addEventListener('DOMContentLoaded',function(){apply(document.documentElement.dataset.theme);
    try{var m=JSON.parse(localStorage.getItem('console-collapsed')||'{}');
      Object.keys(m).forEach(function(id){var el=document.getElementById(id);
        if(el) el.classList.toggle('collapsed', m[id]);});}catch(_){}
  });
})();
</script>"""

# a little status-board icon (dark tile, amber/green/blue dots) — stands out in a tab bar
FAVICON_SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
    '<rect width="64" height="64" rx="14" fill="#12151b"/>'
    '<circle cx="17" cy="19" r="4.5" fill="#f2b34b"/>'
    '<rect x="27" y="15.5" width="26" height="7" rx="3.5" fill="#e6e9ef"/>'
    '<circle cx="17" cy="33" r="4.5" fill="#54c17a"/>'
    '<rect x="27" y="29.5" width="26" height="7" rx="3.5" fill="#e6e9ef" opacity=".8"/>'
    '<circle cx="17" cy="47" r="4.5" fill="#5b9dff"/>'
    '<rect x="27" y="43.5" width="19" height="7" rx="3.5" fill="#e6e9ef" opacity=".65"/>'
    "</svg>"
)
FAVICON = "data:image/svg+xml;base64," + base64.b64encode(FAVICON_SVG.encode()).decode()
FAVICON_TAG = f'<link rel="icon" href="{FAVICON}">'

HOME = """<!doctype html><meta charset=utf-8><title>{{dot}}console</title>{{favicon|safe}}<style>{{css}}</style>{{theme_js|safe}}
<script>window.CONSOLE_PID='';window.CONSOLE_WATCHSEQ={{watch_seq}};</script>
<div class=wrap>
<div class=toolbar><b style="font-size:16px">Orchestration console</b>
  <a href="/backlog?{{q}}"><button class=secondary>Backlog</button></a><span class=sp></span>
  <button class=secondary onclick=toggleTheme() id=themebtn>Dark</button></div>
<div id=refresh-banner class=banner style="display:none">New activity. <a href="#" onclick="location.reload();return false">Refresh</a></div>

{% if needs_items %}
<h2>Needs you ({{needs_items|length}})</h2>
{% for it in needs_items %}
<a class="card needsrow" href="/p/{{it.project}}?{{q}}#{{it.anchor}}">
  <span class=proj>{{it.project}}</span>
  {% if it.code %}<span class=code>{{it.code}}</span> {% endif %}{{it.title}}
  <span class="pill {{'waiting' if it.kind=='thread' else 'open'}}">{{'thread' if it.kind=='thread' else 'decision'}}</span>
</a>
{% endfor %}
{% endif %}

<h2>Projects</h2>
{% for p in projects %}
<div class=card><div class=row>
  <div><a href="/p/{{p.id}}?{{q}}"><b>{{p.title}}</b></a>
  <span class="pill {{p.status}}">{{p.status}}</span></div>
  <div>{% if p.needs %}<span class=badge>{{p.needs}} need you</span>{% endif %}
  {% if p.unread %}<span class=pill>{{p.unread}} new</span>{% endif %}</div>
</div>
<div class=goal>{{p.goal}}</div>
<div class=muted>{{p.running}} running · {{p.open_threads}} threads · {{p.decisions_open}} open decisions</div>
</div>
{% endfor %}
{% if not projects %}<p class=muted>No projects yet.</p>{% endif %}
</div>{{nav_js|safe}}"""

PROJECT = """<!doctype html><meta charset=utf-8><title>{{dot}}{{p.title}}</title>{{favicon|safe}}<style>{{css}}</style>{{theme_js|safe}}
<script>window.CONSOLE_PID='{{p.id}}';window.CONSOLE_WATCHSEQ={{last_seq}};</script>
<div class=wrap>
<div class=toolbar>
  <a href="/?{{q}}"><button class=secondary>← projects</button></a>
  <a href="/backlog?{{q}}"><button class=secondary>Backlog</button></a>
  <button onclick="document.getElementById('ask').scrollIntoView({behavior:'smooth'});document.querySelector('#ask input').focus()">+ Ask</button>
  <button class=secondary onclick="document.getElementById('note').scrollIntoView({behavior:'smooth'})">Note</button>
  <details class=menu><summary class=secondary>View</summary>
    <div class=menucontent>
      <button class=secondary onclick="setAll(false);this.closest('details').open=false">Expand all</button>
      <button class=secondary onclick="setAll(true);this.closest('details').open=false">Collapse all</button>
      <button class=secondary onclick="document.getElementById('feedwrap').open=true;this.closest('details').open=false">What's new</button>
    </div></details>
  <span class=sp></span>
  <button class=secondary onclick=toggleTheme() id=themebtn>Dark</button>
</div>
<div class=strip>
{% for c in nav %}<a id="nav-{{c.id}}" class="chip{% if c.id==current %} cur{% endif %}" href="/p/{{c.id}}?{{q}}"><span class=d-needs style="{% if not c.needs %}display:none{% endif %}"></span><span class=d-new style="{% if not c.new %}display:none{% endif %}"></span>{{c.title}}</a>{% endfor %}
</div>
<div id=refresh-banner class=banner style="display:none">New activity in this project. <a href="#" onclick="location.reload();return false">Refresh</a></div>
<div class=row><h1>{{p.title}} <span class="pill {{p.status}}">{{p.status}}</span></h1></div>
<p class=goal>{{p.goal}}</p>
<div class=card>{{overview|safe}}</div>

<h2>Needs you</h2>
{% for d in needs %}
<div id="decision-{{d.meta.id}}" class="card needs">
  <div class=row><b>{{d.meta.title}}</b><span class="pill {{d.meta.status}}">{{d.meta.status}}</span></div>
  <div class=body>{{d.html|safe}}</div>
  {% if d.meta.pr %}<div class=muted>On PR: <a href="{{d.meta.pr}}">{{d.meta.pr}}</a></div>{% endif %}
  {% if d.meta.status == 'open' %}
  <form method=post action="/p/{{p.id}}/decision/{{d.meta.id}}/answer?{{q}}">
    <textarea name=answer placeholder="Your call (recommendation: {{d.meta.recommendation}})"></textarea>
    <button>Submit answer</button></form>
  {% else %}<div class=muted>You answered: <b>{{d.meta.answer}}</b> · agent is picking it up.</div>{% endif %}
</div>
{% endfor %}
{% if not needs %}<p class=muted>Nothing needs you right now.</p>{% endif %}

<h2>Threads</h2>
<div id=threads>
{% set tlabel = {'waiting':'waiting on you','investigating':'investigating','resolved':'resolved','promoted':'promoted'} %}
{% for t in threads %}
<div id="thread-{{t.meta.id}}" class="card thread{% if t.meta.hidden %} hiddencard{% endif %}{% if t.meta.status == 'waiting' and not t.meta.hidden %} needs{% endif %}{% if t.meta.status in ('resolved','promoted','archived') or t.meta.hidden %} collapsed{% endif %}">
  <div class=thead onclick="toggleCard(this.parentNode)">
    <div class=titlewrap>
      <b>{% if t.meta.code %}<span class=code>{{t.meta.code}}</span> {% endif %}{{t.meta.title}}</b>
      {% if t.last %}<div class=preview>{{t.last}}</div>{% endif %}
    </div>
    <div class=hrow>
      <span class="pill {{t.meta.status}}">{{tlabel.get(t.meta.status, t.meta.status)}}</span>
      <button class=workbtn title="Work on this" data-path="{{t.path}}" onclick="event.stopPropagation();workOn(this,this.dataset.path)">⚡</button>
      {% if t.meta.hidden %}
      <button class=secondary onclick="event.stopPropagation();hideItem(this,'/p/{{p.id}}/thread/{{t.meta.id}}/unhide?{{q}}','thread')">Unhide</button>
      {% else %}
      <button class=hidebtn title=Hide onclick="event.stopPropagation();hideItem(this,'/p/{{p.id}}/thread/{{t.meta.id}}/hide?{{q}}','thread')">×</button>
      {% endif %}
      <span class=caret>▾</span>
    </div>
  </div>
  <div class=tbody>
    <div class=summary>{{t.summary_html|safe}}</div>
    <div class=msgs>
    {% for m in t.messages %}
      <div class="msg{% if m.mine %} mine{% endif %}">
        <div class=mh>{{m.who}} · {{m.time}}</div>
        <div class=mb>{{m.html|safe}}</div>
      </div>
    {% endfor %}
    </div>
    {% if t.meta.promoted_to %}<div class=muted>promoted to task <b>{{t.meta.promoted_to}}</b></div>{% endif %}
    <form method=post action="/p/{{p.id}}/thread/{{t.meta.id}}/message?{{q}}#thread-{{t.meta.id}}">
      <textarea name=text placeholder="Reply in this thread"></textarea>
      <button>Post message</button>
      {% if t.meta.status != 'resolved' %}
      <button class=secondary formaction="/p/{{p.id}}/thread/{{t.meta.id}}/resolve?{{q}}#thread-{{t.meta.id}}" formnovalidate>Resolve</button>
      {% endif %}
      <button class=secondary formaction="/p/{{p.id}}/thread/{{t.meta.id}}/backlog?{{q}}" formnovalidate>Save to backlog</button>
    </form>
  </div>
</div>
{% endfor %}
</div>
{% if not show_hidden %}<a id=hidelink-thread class=hiddenlink data-count="{{hidden_threads}}" href="/p/{{p.id}}?{{q}}{{'&' if q}}hidden=1"{% if not hidden_threads %} style="display:none"{% endif %}>Show {{hidden_threads}} hidden</a>
{% else %}<a class=hiddenlink href="/p/{{p.id}}?{{q}}">Hide archived</a>{% endif %}
{% if not threads %}<p class=muted>No threads yet. Ask a question below to open one.</p>{% endif %}

<h2>Tasks / sub-agents</h2>
{% for t in tasks %}
<div id="task-{{t.meta.id}}" class="card task{% if t.meta.hidden %} hiddencard{% endif %}{% if t.meta.needs_reply and not t.meta.hidden %} needs{% endif %}{% if t.meta.status in ('done','dropped') or t.meta.hidden %} collapsed{% endif %}">
  <div class=thead onclick="toggleCard(this.parentNode)">
    <div class=titlewrap>
      <b>{{t.meta.title}}</b>
      {% if t.last %}<div class=preview>{{t.last}}</div>{% endif %}
    </div>
    <div class=hrow>
      {% if t.meta.needs_reply %}<span class=wait>waiting for agent</span>{% endif %}
      <span class="pill {{t.meta.status}}">{{t.meta.status}}</span>
      <button class=workbtn title="Work on this" data-path="{{t.path}}" onclick="event.stopPropagation();workOn(this,this.dataset.path)">⚡</button>
      {% if t.meta.hidden %}
      <button class=secondary onclick="event.stopPropagation();hideItem(this,'/p/{{p.id}}/task/{{t.meta.id}}/unhide?{{q}}','task')">Unhide</button>
      {% else %}
      <button class=hidebtn title=Hide onclick="event.stopPropagation();hideItem(this,'/p/{{p.id}}/task/{{t.meta.id}}/hide?{{q}}','task')">×</button>
      {% endif %}
      <span class=caret>▾</span>
    </div>
  </div>
  <div class=tbody>
    <div class=muted>{{t.meta.owner}}{% if t.meta.pr %} · <a href="{{t.meta.pr}}">PR</a>{% endif %}{% if t.meta.blocked_on %} · blocked on {{t.meta.blocked_on}}{% endif %}</div>
    {% if t.context_html %}<div class=summary>{{t.context_html|safe}}</div>{% endif %}
    <div class=msgs>
    {% for m in t.messages %}
      <div class="msg{% if m.mine %} mine{% endif %}">
        <div class=mh>{{m.who}} · {{m.time}}</div><div class=mb>{{m.html|safe}}</div>
      </div>
    {% endfor %}
    </div>
    <form method=post action="/p/{{p.id}}/task/{{t.meta.id}}/message?{{q}}#task-{{t.meta.id}}">
      <textarea name=text placeholder="Add a message or note to this task"></textarea>
      <button>Post message</button></form>
  </div>
</div>
{% endfor %}
{% if not show_hidden %}<a id=hidelink-task class=hiddenlink data-count="{{hidden_tasks}}" href="/p/{{p.id}}?{{q}}{{'&' if q}}hidden=1"{% if not hidden_tasks %} style="display:none"{% endif %}>Show {{hidden_tasks}} hidden</a>{% endif %}
{% if not tasks %}<p class=muted>No tasks yet.</p>{% endif %}

<details id=feedwrap>
<summary><b>What's new</b>{% if unread %} <span class=badge>{{unread}} new</span>{% endif %}</summary>
<ul class=feed id=feed>
{% for e in feed %}
<li data-seq="{{e.seq}}"><span class=t>{{e.ts[11:16]}}</span>
<span class="{{'new' if e.seq > seen else ''}}">{{e.text}}</span></li>
{% endfor %}
</ul>
</details>

<h2 id=ask>Ask a question (opens a thread)</h2>
<form method=post action="/p/{{p.id}}/thread?{{q}}">
<input name=title placeholder="Topic (short title)" style="margin-bottom:6px">
<textarea name=text placeholder="Your question or message for the agent"></textarea>
<button>Open thread</button></form>

<h2 id=note>Leave a quick note</h2>
<form method=post action="/p/{{p.id}}/note?{{q}}">
<textarea name=text placeholder="Free-text feedback, not tied to a thread or decision"></textarea>
<button>Post note</button></form>
</div>
<script>
function setAll(collapsed){
  var m={};try{m=JSON.parse(localStorage.getItem('console-collapsed')||'{}')}catch(_){}
  document.querySelectorAll('.thread, .task').forEach(function(el){
    el.classList.toggle('collapsed', collapsed);
    if(el.id) m[el.id]=collapsed;
  });
  try{localStorage.setItem('console-collapsed',JSON.stringify(m))}catch(_){}
}
let last = {{ last_seq }};
async function poll(){
  try{
    const r = await fetch("/p/{{p.id}}/feed.json?since="+last+"&{{q}}");
    const evs = await r.json();
    const ul = document.getElementById("feed");
    for(const e of evs){
      const li=document.createElement("li"); li.dataset.seq=e.seq;
      li.innerHTML='<span class=t>'+e.ts.slice(11,16)+'</span> <span class=new>'+
        e.text.replace(/</g,"&lt;")+'</span>';
      ul.insertBefore(li, ul.firstChild); last=e.seq;
    }
  }catch(_){}
}
setInterval(poll, 4000);
</script>{{nav_js|safe}}"""

BACKLOG = """<!doctype html><meta charset=utf-8><title>Backlog</title>{{favicon|safe}}<style>{{css}}</style>{{theme_js|safe}}
<div class=wrap>
<div class=toolbar><a href="/?{{q}}"><button class=secondary>← projects</button></a>
  <b style="font-size:16px">Backlog</b><span class=sp></span>
  <button class=secondary onclick=toggleTheme() id=themebtn>Dark</button></div>
<p class=goal>Saved notes and future work, kept across all projects.</p>
<h2>Add an idea</h2>
<form method=post action="/backlog/add?{{q}}">
  <input name=title placeholder="Title" required>
  <textarea name=note placeholder="Note (optional)"></textarea>
  <select name=kind><option value=note>note</option><option value=task>task (future work)</option></select>
  <button>Add to backlog</button>
</form>

<h2>Backlog</h2>
{% for it in items %}
<div class="card{% if it.meta.status in ('done','archived') %} collapsed{% endif %}">
  <div class=thead onclick="toggleCard(this.parentNode)">
    <div class=titlewrap><b>{{it.meta.title}}</b></div>
    <div class=hrow><span class="pill {{it.meta.kind}}">{{it.meta.kind}}</span>
      <span class="pill {{it.meta.status}}">{{it.meta.status}}</span>
      <button class=workbtn title="Work on this" data-path="{{it.path}}" onclick="event.stopPropagation();workOn(this,this.dataset.path)">⚡</button>
      <span class=caret>▾</span></div>
  </div>
  <div class=tbody>
    <div class=body>{{it.html|safe}}</div>
    {% if it.meta.source_project %}<div class=muted>from
      <a href="/p/{{it.meta.source_project}}?{{q}}">{{it.meta.source_project}}</a></div>{% endif %}
  </div>
</div>
{% endfor %}
{% if not items %}<p class=muted>Backlog is empty. Add an idea above, or use "Save to backlog" on any thread.</p>{% endif %}
</div>"""

env = Environment(
    loader=DictLoader({"home": HOME, "project": PROJECT, "backlog": BACKLOG}),
    autoescape=select_autoescape(["home", "project", "backlog"]),
)


# --- auth --------------------------------------------------------------------


@app.middleware("http")
async def token_gate(request: Request, call_next):
    if request.url.path in ("/healthz",):
        return await call_next(request)
    if TOKEN:
        supplied = request.query_params.get("token") or request.cookies.get(
            "console_token"
        )
        if supplied != TOKEN:
            return HTMLResponse("unauthorized (append ?token=...)", status_code=401)
        resp = await call_next(request)
        resp.set_cookie("console_token", TOKEN, httponly=True, samesite="lax")
        return resp
    return await call_next(request)


def _q(request: Request) -> str:
    t = request.query_params.get("token")
    return f"token={t}" if t else ""


def _nav_rows(request: Request) -> list[dict]:
    """Per-project glance data: for the switcher strip, home badges, and /nav.json.
    `needs` = things the ball is with the user on; `new` = feed events since you last looked."""
    s = store()
    out = []
    for pmeta in s.list_projects():
        pid = pmeta["id"]
        decisions = [m for m, _ in s.load_decisions(pid)]
        threads = [m for m, _ in s.load_threads(pid) if not m.get("hidden")]
        feed = s.read_feed(pid)
        seen = int(request.cookies.get(f"seen_{pid}", 0))
        out.append(
            {
                "id": pid,
                "title": pmeta["title"],
                "status": pmeta["status"],
                "needs": sum(d["status"] == "open" for d in decisions)
                + sum(t["status"] == "waiting" for t in threads),
                "new": sum(e["seq"] > seen for e in feed),
                "last_seq": feed[-1]["seq"] if feed else 0,
            }
        )
    return out


# updates the switcher-strip dots live and flags new activity, without a full reload
NAV_JS = """<script>
(function(){
  var t=new URLSearchParams(location.search).get('token');
  var url='/nav.json'+(t?('?token='+t):'');
  function tick(){
    fetch(url).then(function(r){return r.json()}).then(function(rows){
      rows.forEach(function(row){
        var chip=document.getElementById('nav-'+row.id);
        if(chip){
          var n=chip.querySelector('.d-needs'), u=chip.querySelector('.d-new');
          if(n) n.style.display=row.needs?'':'none';
          if(u) u.style.display=row['new']?'':'none';
        }
        var watch=(window.CONSOLE_PID? (row.id===window.CONSOLE_PID) : true);
        if(watch && row.last_seq>(window.CONSOLE_WATCHSEQ||0)){
          var b=document.getElementById('refresh-banner'); if(b) b.style.display='';
        }
      });
    }).catch(function(){});
  }
  setInterval(tick, 10000);
})();
</script>"""


# --- routes ------------------------------------------------------------------


@app.get("/healthz")
def healthz():
    return {"ok": True}


@app.get("/nav.json")
def nav_json(request: Request):
    return JSONResponse(_nav_rows(request))


@app.get("/", response_class=HTMLResponse)
def home(request: Request):
    s = store()
    rows = []
    for pmeta in s.list_projects():
        pid = pmeta["id"]
        tasks = [m for m, _ in s.load_tasks(pid)]
        decisions = [m for m, _ in s.load_decisions(pid)]
        threads = [m for m, _ in s.load_threads(pid) if not m.get("hidden")]
        feed = s.read_feed(pid)
        seen = int(request.cookies.get(f"seen_{pid}", 0))
        rows.append(
            {
                **pmeta,
                "running": sum(t["status"] == "running" for t in tasks),
                "decisions_open": sum(d["status"] == "open" for d in decisions),
                "open_threads": sum(
                    t["status"] in ("waiting", "investigating") for t in threads
                ),
                # "needs you" = things where the ball is with the user
                "needs": sum(d["status"] == "open" for d in decisions)
                + sum(t["status"] == "waiting" for t in threads),
                "unread": sum(e["seq"] > seen for e in feed),
            }
        )
    # most urgent first: needs-you, then unread activity, then recently updated
    rows.sort(key=lambda r: r.get("updated", ""), reverse=True)
    rows.sort(key=lambda r: (r["needs"], r["unread"]), reverse=True)  # stable
    # cross-project "needs you": every open decision + waiting thread, with a jump link
    needs_items = []
    for pmeta in s.list_projects():
        pid = pmeta["id"]
        for m, _ in s.load_decisions(pid):
            if m["status"] == "open":
                needs_items.append(
                    {
                        "project": pid,
                        "kind": "decision",
                        "code": "",
                        "title": m["title"],
                        "anchor": f"decision-{m['id']}",
                    }
                )
        for m, _ in s.load_threads(pid):
            if m["status"] == "waiting" and not m.get("hidden"):
                needs_items.append(
                    {
                        "project": pid,
                        "kind": "thread",
                        "code": m.get("code", ""),
                        "title": m["title"],
                        "anchor": f"thread-{m['id']}",
                    }
                )
    watch_seq = max((r.get("last_seq", 0) for r in _nav_rows(request)), default=0)
    return env.get_template("home").render(
        css=BASE_CSS,
        theme_js=THEME_JS,
        nav_js=NAV_JS,
        favicon=FAVICON_TAG,
        dot="● " if any(r["needs"] for r in rows) else "",
        projects=rows,
        needs_items=needs_items,
        watch_seq=watch_seq,
        q=_q(request),
    )


@app.get("/p/{pid}", response_class=HTMLResponse)
def project(pid: str, request: Request, hidden: int = 0):
    show_hidden = bool(hidden)
    s = store()
    try:
        pmeta, pbody = s.load_project(pid)
    except FileNotFoundError:
        return HTMLResponse("no such project", status_code=404)
    needs = [
        {"meta": m, "html": md.render(b)}
        for m, b in s.load_decisions(pid)
        if m["status"] in ("open", "answered")
    ]
    # open first, then answered
    needs.sort(key=lambda d: 0 if d["meta"]["status"] == "open" else 1)
    order = {
        "running": 0,
        "blocked": 1,
        "in-review": 2,
        "queued": 3,
        "done": 4,
        "dropped": 5,
    }

    def msgs(body):
        return [
            {
                "who": x["who"],
                "time": x["time"],
                "mine": x["who"] == "You",
                "html": md.render(x["text"]),
            }
            for x in parse_messages(_section_text(body, "Messages"))
        ]

    def keep(m):  # hidden items are dropped unless the user asked to see them
        return show_hidden or not m.get("hidden")

    all_tasks = list(s.load_tasks(pid))
    tasks = sorted(
        [
            {
                "meta": m,
                "path": f"{ROOT}/{pid}/tasks/{m['id']}.md",
                "context_html": md.render(_section_text(b, "Context"))
                if _section_text(b, "Context")
                else "",
                "last": Store._last_message(
                    b
                ),  # one-line preview, shown when collapsed
                "messages": msgs(b),
            }
            for m, b in all_tasks
            if keep(m)
        ],
        key=lambda t: order.get(t["meta"]["status"], 9),
    )
    hidden_tasks = sum(1 for m, _ in all_tasks if m.get("hidden"))
    # threads: waiting-on-you first, then the agent's active work, then resolved
    torder = {"waiting": 0, "investigating": 1, "promoted": 2, "resolved": 3}
    all_threads = [(m, b) for m, b in s.load_threads(pid) if m["status"] != "archived"]
    threads = [
        {
            "meta": m,
            "path": f"{ROOT}/{pid}/threads/{m['id']}.md",
            "summary_html": md.render(
                _section_text(b, "Summary") or "_No summary yet._"
            ),
            "last": Store._last_message(b),  # one-line preview, shown when collapsed
            "messages": msgs(b),
        }
        for m, b in all_threads
        if keep(m)
    ]
    threads.sort(key=lambda t: torder.get(t["meta"]["status"], 4))
    hidden_threads = sum(1 for m, _ in all_threads if m.get("hidden"))
    feed = s.read_feed(pid)
    seen = int(request.cookies.get(f"seen_{pid}", 0))
    last_seq = feed[-1]["seq"] if feed else 0
    # only VISIBLE items count toward "needs you" (a hidden thread should not nag)
    waiting_on_user = any(d["meta"]["status"] == "open" for d in needs) or any(
        t["meta"]["status"] == "waiting" and not t["meta"].get("hidden")
        for t in threads
    )
    html = env.get_template("project").render(
        css=BASE_CSS,
        theme_js=THEME_JS,
        nav_js=NAV_JS,
        nav=_nav_rows(request),
        current=pid,
        favicon=FAVICON_TAG,
        dot="● " if waiting_on_user else "",
        p=pmeta,
        overview=md.render(pbody),
        needs=needs,
        threads=threads,
        tasks=tasks,
        feed=list(reversed(feed)),
        seen=seen,
        unread=sum(e["seq"] > seen for e in feed),
        last_seq=last_seq,
        show_hidden=show_hidden,
        hidden_threads=hidden_threads,
        hidden_tasks=hidden_tasks,
        q=_q(request),
    )
    resp = HTMLResponse(html)
    resp.set_cookie(f"seen_{pid}", str(last_seq), samesite="lax")
    return resp


@app.get("/p/{pid}/feed.json")
def feed_json(pid: str, since: int = 0):
    return JSONResponse(store().read_feed(pid, since))


@app.post("/p/{pid}/decision/{did}/answer")
def answer(pid: str, did: str, request: Request, answer: str = Form(...)):
    try:
        store().decision_answer(pid, did, answer.strip(), by="user")
    except (FileNotFoundError, ValueError) as e:
        return HTMLResponse(f"error: {e}", status_code=400)
    return RedirectResponse(f"/p/{pid}?{_q(request)}#decision-{did}", status_code=303)


@app.post("/p/{pid}/note")
def note(pid: str, request: Request, text: str = Form(...)):
    if text.strip():
        store().note_add(pid, text.strip(), by="user")
    return RedirectResponse(f"/p/{pid}?{_q(request)}", status_code=303)


@app.post("/p/{pid}/thread")
def thread_new(
    pid: str, request: Request, title: str = Form(...), text: str = Form("")
):
    """User opens a new thread (asks a question) from the UI."""
    if title.strip():
        # slug the title into an id; keep it readable and unique-ish
        base = "".join(c if c.isalnum() else "-" for c in title.lower()).strip("-")[:40]
        tid = base or "thread"
        s = store()
        existing = {m["id"] for m, _ in s.load_threads(pid)}
        tid = tid if tid not in existing else f"{tid}-{len(existing) + 1}"
        s.thread_new(pid, tid, title.strip(), first_message=text.strip(), by="user")
    return RedirectResponse(f"/p/{pid}?{_q(request)}", status_code=303)


@app.post("/p/{pid}/thread/{tid}/message")
def thread_message(pid: str, tid: str, request: Request, text: str = Form(...)):
    if text.strip():
        try:
            store().thread_message(pid, tid, text.strip(), by="user")
        except FileNotFoundError as e:
            return HTMLResponse(f"error: {e}", status_code=400)
    # land back on the same thread instead of jumping to the top of the page
    return RedirectResponse(f"/p/{pid}?{_q(request)}#thread-{tid}", status_code=303)


@app.post("/p/{pid}/task/{tid}/message")
def task_message(pid: str, tid: str, request: Request, text: str = Form(...)):
    if text.strip():
        try:
            store().task_message(pid, tid, text.strip(), by="user")
        except FileNotFoundError as e:
            return HTMLResponse(f"error: {e}", status_code=400)
    return RedirectResponse(f"/p/{pid}?{_q(request)}#task-{tid}", status_code=303)


@app.post("/p/{pid}/thread/{tid}/resolve")
def thread_resolve(pid: str, tid: str, request: Request):
    try:
        store().thread_set(pid, tid, status="resolved")
    except (FileNotFoundError, ValueError) as e:
        return HTMLResponse(f"error: {e}", status_code=400)
    return RedirectResponse(f"/p/{pid}?{_q(request)}#thread-{tid}", status_code=303)


@app.post("/p/{pid}/{kind}/{item_id}/hide")
def hide_item(pid: str, kind: str, item_id: str, request: Request):
    # called via fetch() so the page never reloads: no scroll jump, collapse state kept
    try:
        store().set_hidden(pid, kind, item_id, True)
    except (FileNotFoundError, ValueError) as e:
        return HTMLResponse(f"error: {e}", status_code=400)
    return JSONResponse({"ok": True})


@app.post("/p/{pid}/{kind}/{item_id}/unhide")
def unhide_item(pid: str, kind: str, item_id: str, request: Request):
    try:
        store().set_hidden(pid, kind, item_id, False)
    except (FileNotFoundError, ValueError) as e:
        return HTMLResponse(f"error: {e}", status_code=400)
    return JSONResponse({"ok": True})


@app.post("/p/{pid}/thread/{tid}/backlog")
def thread_to_backlog(pid: str, tid: str, request: Request):
    """Save this thread into the cross-project backlog as a future item."""
    s = store()
    bid = f"{pid}-{tid}"
    # avoid a collision if it was already saved once
    if (s._backlog_dir() / f"{bid}.md").exists():
        bid = f"{bid}-{len(s.load_backlog()) + 1}"
    try:
        s.backlog_from_thread(pid, tid, bid=bid, kind="task")
    except FileNotFoundError as e:
        return HTMLResponse(f"error: {e}", status_code=400)
    return RedirectResponse(f"/backlog?{_q(request)}", status_code=303)


@app.get("/backlog", response_class=HTMLResponse)
def backlog(request: Request):
    s = store()
    order = {"open": 0, "doing": 1, "done": 2, "archived": 3}
    items = [
        {"meta": m, "html": md.render(b), "path": f"{ROOT}/_backlog/{m['id']}.md"}
        for m, b in s.load_backlog()
    ]
    items.sort(key=lambda it: order.get(it["meta"].get("status"), 4))
    return env.get_template("backlog").render(
        css=BASE_CSS, theme_js=THEME_JS, favicon=FAVICON_TAG, items=items, q=_q(request)
    )


@app.post("/backlog/add")
def backlog_add_route(
    request: Request,
    title: str = Form(...),
    note: str = Form(""),
    kind: str = Form("note"),
):
    """Add a backlog item straight from the backlog page (an idea, not tied to a thread)."""
    if title.strip():
        s = store()
        base = "".join(c if c.isalnum() else "-" for c in title.lower()).strip("-")[:40]
        bid = base or "item"
        existing = {m["id"] for m, _ in s.load_backlog()}
        bid = bid if bid not in existing else f"{bid}-{len(existing) + 1}"
        s.backlog_add(
            bid,
            title.strip(),
            note.strip(),
            kind if kind in ("note", "task") else "note",
        )
    return RedirectResponse(f"/backlog?{_q(request)}", status_code=303)


def main():
    global ROOT
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=ROOT)
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=8799)
    args = ap.parse_args()
    ROOT = args.root
    import uvicorn

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
