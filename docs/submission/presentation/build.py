# Builds Turnspike-presentation.pptx (draft for the owner to edit and present). pip install python-pptx; python build.py
from pathlib import Path
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.util import Inches, Pt
from pptx.enum.shapes import MSO_SHAPE

INK, PAPER, YELLOW, GREY = RGBColor(0x1B, 0x1F, 0x24), RGBColor(0xE9, 0xED, 0xE6), RGBColor(0xF2, 0xB7, 0x05), RGBColor(0x4A, 0x52, 0x5A)
here = Path(__file__).parent
shots = here.parent.parent / "screenshots" / "rc"
p = Presentation()
p.slide_width, p.slide_height = Inches(13.333), Inches(7.5)

def box(s, x, y, w, h, color):
    b = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
    b.fill.solid(); b.fill.fore_color.rgb = color; b.line.fill.background(); b.shadow.inherit = False
    return b
def text(s, x, y, w, h, lines, size=20, bold=False, color=INK, gap=8):
    tf = s.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h)).text_frame
    tf.word_wrap = True
    for i, l in enumerate(lines):
        para = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        para.space_after = Pt(gap)
        r = para.add_run(); r.text = l
        r.font.size, r.font.bold, r.font.color.rgb, r.font.name = Pt(size), bold, color, "Arial"
def slide(title, lines, notes, shot=None, size=20):
    s = p.slides.add_slide(p.slide_layouts[6])
    box(s, 0, 0, 13.333, 7.5, PAPER); box(s, 0, 0, 13.333, 0.16, YELLOW)
    text(s, 0.7, 0.5, 11.9, 1.1, [title], 34, True)
    pic = shots / shot if shot else None
    text(s, 0.7, 1.75, 5.4 if pic else 11.6, 5.2, lines, size, gap=12)
    if pic: s.shapes.add_picture(str(pic), Inches(6.5), Inches(1.8), width=Inches(6.2))
    text(s, 0.7, 6.95, 12, 0.4, ["Turnspike. Unaudited, small amounts only. All mainnet payments so far are project-operated."], 11, color=GREY)
    s.notes_slide.notes_text_frame.text = notes
    return s

s = p.slides.add_slide(p.slide_layouts[6])
box(s, 0, 0, 13.333, 7.5, INK); box(s, 0, 6.2, 13.333, 0.16, YELLOW)
text(s, 0.9, 2.0, 11.5, 2.4, ["Agents pay at the gate.", "Owners set the toll."], 58, True, PAPER, 0)
text(s, 0.9, 4.6, 11.5, 1.2, ["Turnspike: per-request API payments in QUSDC on QIE Mainnet, inside limits the contract enforces."], 22, color=PAPER)
text(s, 0.9, 6.55, 11.5, 0.6, ["QIE Hackathon 3.0   |   turnspike-qie.vercel.app   |   github.com/ometere123/Turnspike"], 14, color=PAPER)
s.notes_slide.notes_text_frame.text = "Draft. Presenter: introduce yourself in your own words."

slide("An agent that can pay needs a budget it cannot break", [
    "To pay for an API by itself, an agent usually gets a key with no hard ceiling.",
    "One bug, prompt injection or malicious response can drain whatever the key can reach.",
    "A seller who wants to charge per request has to build verification, replay protection and crash recovery first.",
    "This is the motivating scenario, not a measured market figure."], "Say it as a story: one agent, one key, one bad night.", size=24)
slide("The owner's rules live in the settlement contract", [
    "Per-call cap, daily cap, merchant allowlist, pause, revoke, single-use request IDs.",
    "Checked inside every payment. The agent, its SDK and the seller cannot skip them.",
    "No admin, no upgrade, no rescue function. Withdrawals are never blocked."],
    "Screenshot: local chain, test token, mock wallet. Say so out loud.", "console-local.png")
slide("One lane, five stops", [
    "1. Request: the agent asks for a protected resource.",
    "2. Quote: HTTP 402, signed, expiring, bound to that one request.",
    "3. Pay: pay() on the allowance contract, in QUSDC.",
    "4. Verify: the seller reads the Paid event from QIE and waits for confirmations.",
    "5. Pass: the response is stored, then sent. The same proof returns the same response."], "If asked: the sig in the 402 is the secret half of the proof.", size=24)
slide("Check a payment without trusting us", [
    "The operations page reads the receipt from QIE, then asks the gateway.",
    "Settlement is on chain. Delivery is the gateway's own claim. The page never merges them.",
    "Shown: a project-operated purchase of 19 November 2026, 0.001 QUSDC.",
    "Anything unknown, pending, stale or mismatched is never shown as success."], "Screenshot shows the historical payment read live. Offer to do it on the judge's own machine.", "operations-historical.png")
slide("What is built", [
    "TurnpikeAllowance on QIE Mainnet, source verified: 0xa2f2e042861a593cc582c6d2d43a24457dcf5d9c",
    "Seller middleware, agent SDK and CLI on npm: @turnspike-qie/middleware, client, cli",
    "Public gateway with three paid endpoints, owner console, operations center, playground",
    "Tests: 15 contract, 121 middleware, gateway, SDK, CLI and web, plus a real-browser suite (local chain, test token)",
    "QIE components: QIE Mainnet, QUSDC, QIE RPC and explorer, and an optional display-only QIE ID lookup"], "Numbers: docs/RELEASE_QA.md at the release commit.", size=22)
slide("When things go wrong", [
    "Agent crashes after paying: its journal finds the payment and collects the response. No second charge for that purchase.",
    "Seller crashes mid-delivery: the lease lapses and the same proof is honoured.",
    "Wallet drops after sending: the console says outcome unknown and reads the chain. It never offers a blind retry.",
    "Not solved: no automatic refund for late or undelivered payments, and a restored backup does not know newer challenges."], "The last line matters: judges trust the first three more because of it.", size=22)
slide("What we do not claim", [
    "Not audited. The deployed bytecode is a coverage-instrumented build; we reproduced it exactly, which is not an audit.",
    "Not x402-compatible. An experimental scheme was built, not proven on a public network, and not merged.",
    "Not first, and no ingredient is claimed as invented here. The claim is the combination.",
    "No external users or merchants yet. One chain, one token, one gateway."], "Be ready for: was this AI generated? Answer from your own log.", size=24)
slide("Next", [
    "An outside developer runs the onboarding guide.",
    "An independent security review, then a contract with a per-owner replay key.",
    "Refund and reconciliation procedure for late and undelivered payments.",
    "Try it: turnspike-qie.vercel.app/operations, or npm i @turnspike-qie/client"], "Close with the live operations page.", size=24)
p.save(here / "Turnspike-presentation.pptx")
