// Math in answers (Part 2, spec 5): a small LaTeX subset turned into MathML,
// which Safari renders natively. Built with createElementNS and textContent
// only, like the Markdown renderer. Unknown commands show as their source text.
//
// Supports: numbers, letters, operators, ^ and _ (with {groups}), \frac,
// \sqrt (and \sqrt[n]), \text / \mathrm, \left / \right delimiters, Greek
// letters, common relations and operators, big operators (\sum, \prod, \int)
// with limits, and named functions (\sin, \log, \lim, ...).
const MATHML = "http://www.w3.org/1998/Math/MathML";
const MAX_TEX = 2000;
const MAX_DEPTH = 24;

const GREEK: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ",
  vartheta: "ϑ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", varpi: "ϖ", rho: "ρ",
  sigma: "σ", tau: "τ", upsilon: "υ", phi: "φ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
};

const OPS: Record<string, string> = {
  times: "×", cdot: "⋅", div: "÷", pm: "±", mp: "∓", le: "≤", leq: "≤", ge: "≥", geq: "≥", ne: "≠", neq: "≠",
  approx: "≈", equiv: "≡", sim: "∼", propto: "∝", to: "→", rightarrow: "→", leftarrow: "←", Rightarrow: "⇒",
  Leftarrow: "⇐", leftrightarrow: "↔", Leftrightarrow: "⇔", mapsto: "↦", in: "∈", notin: "∉", subset: "⊂",
  subseteq: "⊆", supset: "⊃", supseteq: "⊇", cup: "∪", cap: "∩", setminus: "∖", forall: "∀", exists: "∃",
  neg: "¬", land: "∧", lor: "∨", partial: "∂", nabla: "∇", infty: "∞", ldots: "…", cdots: "⋯", dots: "…",
  circ: "∘", degree: "°", prime: "′", langle: "⟨", rangle: "⟩", lfloor: "⌊", rfloor: "⌋", lceil: "⌈", rceil: "⌉",
  emptyset: "∅", angle: "∠", perp: "⊥", parallel: "∥", ll: "≪", gg: "≫", "{": "{", "}": "}", "%": "%", "$": "$",
  "&": "&", "#": "#", ",": " ", ";": " ", ":": " ", "!": "", quad: " ", qquad: "  ", "\\": "\n",
};

const BIG: Record<string, string> = { sum: "∑", prod: "∏", int: "∫", iint: "∬", oint: "∮", bigcup: "⋃", bigcap: "⋂" };

const FUNCS = new Set(["sin", "cos", "tan", "cot", "sec", "csc", "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh", "log", "ln", "exp", "lim", "max", "min", "sup", "inf", "det", "gcd", "deg", "dim", "mod"]);

type Tok =
  | { t: "cmd"; v: string }
  | { t: "{" }
  | { t: "}" }
  | { t: "^" }
  | { t: "_" }
  | { t: "num"; v: string }
  | { t: "chr"; v: string }
  /** \text{...}: kept as written, spaces included. */
  | { t: "txt"; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  for (let i = 0; i < src.length; ) {
    const c = src[i]!;
    const text = /^\\(?:text|mathrm|textrm|operatorname)\s*\{/.exec(src.slice(i));
    if (text) {
      let j = i + text[0].length;
      let level = 0;
      let v = "";
      for (; j < src.length; j++) {
        const d = src[j]!;
        if (d === "{") level++;
        else if (d === "}") {
          if (level === 0) break;
          level--;
        }
        v += d;
      }
      out.push({ t: "txt", v });
      i = j + 1;
      continue;
    }
    if (c === "\\") {
      const m = /^\\([A-Za-z]+|.)/.exec(src.slice(i));
      if (m) {
        out.push({ t: "cmd", v: m[1]! });
        i += m[0].length;
        continue;
      }
      i++;
    } else if (c === "{" || c === "}" || c === "^" || c === "_") {
      out.push({ t: c });
      i++;
    } else if (/\d/.test(c)) {
      const m = /^\d+(?:\.\d+)?/.exec(src.slice(i))!;
      out.push({ t: "num", v: m[0] });
      i += m[0].length;
    } else if (/\s/.test(c)) i++;
    else {
      out.push({ t: "chr", v: c });
      i++;
    }
  }
  return out;
}

class Builder {
  private i = 0;
  constructor(
    private readonly doc: Document,
    private readonly toks: Tok[],
    private readonly display: boolean,
  ) {}

  private el(name: string, ...kids: Node[]): Element {
    const e = this.doc.createElementNS(MATHML, name);
    for (const k of kids) e.appendChild(k);
    return e;
  }
  private leaf(name: string, text: string): Element {
    const e = this.doc.createElementNS(MATHML, name);
    e.textContent = text;
    return e;
  }

  /** Items until a closing brace or the end. */
  expr(depth: number): Element {
    const row = this.el("mrow");
    while (this.i < this.toks.length && this.toks[this.i]!.t !== "}") {
      const atom = this.script(depth);
      if (atom) row.appendChild(atom);
    }
    return row;
  }

  /** A {group} or a single atom, as a required argument. */
  private arg(depth: number): Element {
    if (this.toks[this.i]?.t === "{") {
      this.i++;
      const row = this.expr(depth + 1);
      if (this.toks[this.i]?.t === "}") this.i++;
      return row;
    }
    return this.atom(depth + 1) ?? this.el("mrow");
  }

  private script(depth: number): Element | null {
    let base = this.atom(depth);
    if (!base) return null;
    const big = base.getAttribute("data-big") === "1";
    let sub: Element | null = null;
    let sup: Element | null = null;
    for (let k = 0; k < 2; k++) {
      const t = this.toks[this.i]?.t;
      if (t === "_" && !sub) {
        this.i++;
        sub = this.arg(depth);
      } else if (t === "^" && !sup) {
        this.i++;
        sup = this.arg(depth);
      }
    }
    base.removeAttribute("data-big");
    if (sub && sup) base = this.el(big && this.display ? "munderover" : "msubsup", base, sub, sup);
    else if (sub) base = this.el(big && this.display ? "munder" : "msub", base, sub);
    else if (sup) base = this.el(big && this.display ? "mover" : "msup", base, sup);
    return base;
  }

  private atom(depth: number): Element | null {
    const tok = this.toks[this.i];
    if (!tok) return null;
    if (depth > MAX_DEPTH) {
      this.i = this.toks.length;
      return this.leaf("mtext", "…");
    }
    this.i++;
    switch (tok.t) {
      case "num":
        return this.leaf("mn", tok.v);
      case "txt":
        return this.leaf("mtext", tok.v);
      case "chr":
        return /[A-Za-z]/.test(tok.v) ? this.leaf("mi", tok.v) : this.leaf("mo", tok.v);
      case "{": {
        const row = this.expr(depth + 1);
        if (this.toks[this.i]?.t === "}") this.i++;
        return row;
      }
      case "^":
      case "_":
      case "}":
        return null;
      case "cmd":
        return this.command(tok.v, depth);
    }
  }

  private command(name: string, depth: number): Element {
    if (name === "frac" || name === "dfrac" || name === "tfrac") {
      const num = this.arg(depth);
      return this.el("mfrac", num, this.arg(depth));
    }
    if (name === "sqrt") {
      if (this.toks[this.i]?.t === "chr" && (this.toks[this.i] as { v: string }).v === "[") {
        this.i++;
        const index = this.el("mrow");
        while (this.i < this.toks.length && !(this.toks[this.i]!.t === "chr" && (this.toks[this.i] as { v: string }).v === "]")) {
          const a = this.script(depth + 1);
          if (a) index.appendChild(a);
        }
        this.i++;
        return this.el("mroot", this.arg(depth), index);
      }
      return this.el("msqrt", this.arg(depth));
    }
    if (name === "mathbf" || name === "boldsymbol" || name === "mathit" || name === "mathcal" || name === "mathbb") return this.arg(depth);
    if (name === "left" || name === "right") {
      const d = this.toks[this.i];
      if (!d) return this.el("mrow");
      this.i++;
      const v = d.t === "chr" ? d.v : d.t === "cmd" ? (OPS[d.v] ?? (d.v === "|" ? "‖" : "")) : "";
      return v === "." ? this.el("mrow") : this.leaf("mo", v);
    }
    if (GREEK[name]) return this.leaf("mi", GREEK[name]);
    if (BIG[name]) {
      const op = this.leaf("mo", BIG[name]);
      op.setAttribute("largeop", "true");
      op.setAttribute("data-big", "1");
      return op;
    }
    if (FUNCS.has(name)) {
      const fn = this.leaf("mi", name);
      if (name === "lim" || name === "max" || name === "min" || name === "sup" || name === "inf") fn.setAttribute("data-big", "1");
      return fn;
    }
    if (name in OPS) return this.leaf("mo", OPS[name]!);
    return this.leaf("mtext", "\\" + name);
  }
}

/** A <math> element for `tex`. Never throws; very long input is shown as text. */
export function texToMathML(doc: Document, tex: string, display: boolean): Element {
  const math = doc.createElementNS(MATHML, "math");
  math.setAttribute("display", display ? "block" : "inline");
  // Read by assistive technology where MathML is not.
  math.setAttribute("alttext", tex.slice(0, MAX_TEX));
  if (tex.length > MAX_TEX) {
    const t = doc.createElementNS(MATHML, "mtext");
    t.textContent = tex.slice(0, MAX_TEX) + "…";
    math.appendChild(t);
    return math;
  }
  math.appendChild(new Builder(doc, tokenize(tex), display).expr(0));
  return math;
}
