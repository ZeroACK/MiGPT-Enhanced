/**
 * Aho–Corasick matching.
 *
 * The router asks one question of every utterance: does it mention a device
 * word, a control verb, a question marker or a media command? Answering that by
 * looping over the vocabulary costs `words × text` substring scans, which grows
 * with every alias the user adds (device names, `extraDeviceWords`, category
 * words per MIoT model).
 *
 * Aho–Corasick answers the same question in `text` steps regardless of the
 * vocabulary size: all patterns are compiled into one automaton, the utterance
 * is scanned once left to right, and a match is returned as soon as any pattern
 * completes. Nothing after that point is examined — that is the early stop.
 *
 * The implementation is small enough to keep in-tree (no dependency): one node
 * per distinct character, failure links found breadth first, and each node
 * carries a list of the patterns that end there, longest first.
 */

/**
 * @typedef {object} Match
 * @property {string} pattern the matched vocabulary word
 * @property {number} start code-point offset of the first matched character
 * @property {number} end code-point offset just past the match
 */

export class AhoCorasick {
  /** @type {Array<{next: Map<string, number>, fail: number, out: number[]}>} */
  #nodes = [{ next: new Map(), fail: 0, out: [] }];

  /** @type {string[]} */
  #patterns = [];

  /** @type {number[]} code-point length per pattern, used for match starts */
  #lengths = [];

  /** @type {boolean} */
  #built = false;

  /**
   * @param {Iterable<string>} [patterns]
   */
  constructor(patterns = []) {
    for (const pattern of patterns) this.add(pattern);
    this.build();
  }

  /**
   * Adds one pattern. The automaton is rebuilt lazily on the next match, so a
   * batch of additions costs one build.
   *
   * @param {string} pattern
   * @returns {this}
   */
  add(pattern) {
    if (typeof pattern !== "string" || pattern.length === 0) return this;
    let node = 0;
    for (const character of pattern) {
      const next = this.#nodes[node].next.get(character);
      if (next === undefined) {
        const child = this.#nodes.length;
        this.#nodes.push({ next: new Map(), fail: 0, out: [] });
        this.#nodes[node].next.set(character, child);
        node = child;
      } else {
        node = next;
      }
    }
    this.#nodes[node].out.push(this.#patterns.length);
    this.#patterns.push(pattern);
    this.#lengths.push([...pattern].length);
    this.#built = false;
    return this;
  }

  /**
   * Builds the failure links and merges the outputs of every node with the
   * outputs it would reach through its failure chain, so a scan never has to
   * walk that chain.
   *
   * @returns {this}
   */
  build() {
    if (this.#built) return this;
    const nodes = this.#nodes;
    const queue = [];

    for (const child of nodes[0].next.values()) {
      nodes[child].fail = 0;
      queue.push(child);
    }

    while (queue.length > 0) {
      const node = /** @type {number} */ (queue.shift());
      for (const [character, child] of nodes[node].next) {
        let fallback = nodes[node].fail;
        while (fallback !== 0 && !nodes[fallback].next.has(character)) {
          fallback = nodes[fallback].fail;
        }
        const target = nodes[fallback].next.get(character);
        nodes[child].fail = target === undefined || target === child ? 0 : target;
        queue.push(child);

        // Longest pattern first: when several end at the same position, the
        // longest one is the most specific ("灯带" beats "灯").
        const inherited = nodes[nodes[child].fail].out;
        if (inherited.length > 0) nodes[child].out = nodes[child].out.concat(inherited);
        nodes[child].out.sort((a, b) => this.#lengths[b] - this.#lengths[a]);
      }
    }

    this.#built = true;
    return this;
  }

  /** Number of distinct patterns. */
  get size() {
    return this.#patterns.length;
  }

  /**
   * Scans the text once and returns the first completed match: the match that
   * ends earliest, and among those ending together, the longest. The scan stops
   * at that point; the rest of the text is never looked at.
   *
   * @param {string} text
   * @returns {Match | undefined}
   */
  matchFirst(text) {
    this.build();
    const nodes = this.#nodes;
    let node = 0;
    let index = 0;

    for (const character of text) {
      while (node !== 0 && !nodes[node].next.has(character)) node = nodes[node].fail;
      const next = nodes[node].next.get(character);
      node = next === undefined ? 0 : next;
      index += 1;

      const out = nodes[node].out;
      if (out.length > 0) {
        const pattern = this.#patterns[out[0]];
        return { pattern, start: index - this.#lengths[out[0]], end: index };
      }
    }
    return undefined;
  }

  /**
   * Whether any pattern occurs in the text. Stops at the first completion, so
   * this is the cheapest presence check.
   *
   * @param {string} text
   * @returns {boolean}
   */
  has(text) {
    return this.matchFirst(text) !== undefined;
  }

  /**
   * Returns the longest pattern that starts at offset 0, if any.
   *
   * Only the trie is walked, one node per leading character, and the walk stops
   * at the first character that is not a prefix of some pattern.
   *
   * @param {string} text
   * @returns {Match | undefined}
   */
  matchPrefix(text) {
    this.build();
    const nodes = this.#nodes;
    let node = 0;
    let index = 0;
    /** @type {Match | undefined} */
    let best;

    for (const character of text) {
      const next = nodes[node].next.get(character);
      if (next === undefined) break;
      node = next;
      index += 1;

      // Longest first, so the first candidate whose length equals the depth
      // starts at 0 and is the longest prefix available here.
      for (const patternIndex of nodes[node].out) {
        if (this.#lengths[patternIndex] !== index) continue;
        best = {
          pattern: this.#patterns[patternIndex],
          start: 0,
          end: index,
        };
        break;
      }
    }
    return best;
  }
}
