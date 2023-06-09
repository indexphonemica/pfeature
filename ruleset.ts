import { BaseCharacter, FeatureBundle, FeatureSchema, TemporalFeatureBundle, Modifier, ModifierRule } from './feature_schema'
import * as fs from 'fs'
import { set_eq, warn, string_to_codepoints } from './util'

const RS_COMMENT = '#'
const RS_META = '__meta'

const RS_BASE = '='
const RS_BASE_FULL = 'base'
const RS_BASE_DERIVED = '*='
const RS_BASE_DERIVED_FULL = 'derive'

const RS_MOD_COMBINING = '^='
const RS_MOD_COMBINING_FULL = 'combin'
const RS_MOD_SUFFIX = '=>'
const RS_MOD_SUFFIX_FULL = 'suffix'
const RS_MOD_PREFIX = '<='
const RS_MOD_PREFIX_FULL = 'prefix'

const RS_ALIAS = '*' // must be one char since we check str[0]

const RS_FVAL_FALSE = '-'
const RS_FVAL_FALSE_FULL = 'false'
const RS_FVAL_TRUE = '+'
const RS_FVAL_TRUE_FULL = 'true'
const RS_FVAL_NULL = '0'
const RS_FVAL_NULL_FULL = 'null'

// TODO unused
type FeaturalizedSegment = Map<string, string | string[]>

type SegmentModifiers = Set<string>

/**
 * A unit segment is a single complete bundle of features (a representation of a segment) without any temporal dimension.
 */
class UnitSegment {
	base: string
	prefixal_modifiers: SegmentModifiers
	combining_modifiers: SegmentModifiers
	suffixal_modifiers: SegmentModifiers

	constructor(props: {
		base: string, 
		prefixal_modifiers: SegmentModifiers, 
		combining_modifiers: SegmentModifiers, 
		suffixal_modifiers: SegmentModifiers 
	}) {
		this.base = props.base
		this.prefixal_modifiers = props.prefixal_modifiers
		this.combining_modifiers = props.combining_modifiers
		this.suffixal_modifiers = props.suffixal_modifiers
	}

	toString() {
		const components = [
			[...this.prefixal_modifiers].map(string_to_codepoints).join('+'),
			string_to_codepoints(this.base).join('+'),
			[...this.combining_modifiers].map(string_to_codepoints).join('+'),
			[...this.suffixal_modifiers].map(string_to_codepoints).join('+')
		]
		return `{${components.map(str => str.length ? str : '0').join('-')}}`
	}

	// FIXME this feels wrong - why don't we just save the raw string when we create the UnitSegment?
	get raw() {
		const prefixes = [...this.prefixal_modifiers].join('')
		const combinings = [...this.combining_modifiers].join('')
		const suffixes = [...this.suffixal_modifiers].join('')
		return `${prefixes}${this.base}${combinings}${suffixes}`
	}

	/** Creates a new UnitSegment with the same modifiers as this one, but in normalized order as specified by 
	 *  the three order map args. 
	 */
	get_normalized(prefix_order: Map<string, number>, combining_order: Map<string, number>, suffix_order: Map<string, number>) {
		const compare_fn = (a: string, b: string, m: Map<string, number>) => {
			if (!m.has(a)) throw new Error(`Couldn't find order info for ${a}`)
			if (!m.has(b)) throw new Error(`Couldn't find order info for ${b}`)
			return m.get(a)! - m.get(b)!
		}

		const new_prefixes = [...this.prefixal_modifiers].sort( (a, b) => compare_fn(a, b, prefix_order) )
		const new_combinings = [...this.combining_modifiers].sort( (a, b) => compare_fn(a, b, combining_order) )
		const new_suffixes = [...this.suffixal_modifiers].sort( (a, b) => compare_fn(a, b, suffix_order) )

		return new UnitSegment({
			base: this.base,
			prefixal_modifiers: new Set(new_prefixes),
			combining_modifiers: new Set(new_combinings),
			suffixal_modifiers: new Set(new_suffixes)
		})
	}

	is_normalized(prefix_order: Map<string, number>, combining_order: Map<string, number>, suffix_order: Map<string, number>) {
		let norm = this.get_normalized(prefix_order, combining_order, suffix_order)
		return this.eq(norm)
	}

	eq(s: UnitSegment) {
		if ( this.base !== s.base ) return false
		if ( !set_eq(this.prefixal_modifiers,  s.prefixal_modifiers)  ) return false
		if ( !set_eq(this.combining_modifiers, s.combining_modifiers) ) return false
		if ( !set_eq(this.suffixal_modifiers,  s.suffixal_modifiers)  ) return false
		return true
	}
}

function merge<T>(s: Set<T>, ...ts: T[]) {
	let ns: Set<T> = new Set(s)
	for (let t of ts) ns.add(t)
	return ns
}

class Segment {
	units: UnitSegment[]
	#raw: string
	prefix_queue: SegmentModifiers

	constructor(raw: string) {
		this.#raw = raw
		this.units = []
		this.prefix_queue = new Set()
	}

	/** The rightmost UnitSegment in this Segment. */
	get curr() {
		return this.units[this.units.length-1]
	}

	/** The number of UnitSegments in this Segment. */
	get base_count() {
		return this.units.length
	}

	add_prefixes(prefixes: SegmentModifiers) {
		if (this.units.length === 0) {
			this.prefix_queue = merge(this.prefix_queue, ...prefixes)
		} else {
			this.curr.prefixal_modifiers = merge(this.curr.prefixal_modifiers, ...prefixes)
		}
	}

	add_base(base: string) {
		let prefixes: SegmentModifiers = (this.units.length === 0) ? this.prefix_queue : new Set()

		this.units.push(new UnitSegment({
			prefixal_modifiers: prefixes,
			base,
			combining_modifiers: new Set(),
			suffixal_modifiers: new Set()
		}))
	}

	add_combinings(combinings: SegmentModifiers) {
		this.curr.combining_modifiers = merge(this.curr.combining_modifiers, ...combinings)
	}

	add_suffixes(suffixes: SegmentModifiers) {
		this.curr.suffixal_modifiers = merge(this.curr.suffixal_modifiers, ...suffixes)
	}

	toString() {
		return `${this.#raw} (${this.units.map(x => x.toString())})`
	}

	get_normalized(ruleset: Ruleset) {
		return Segment.fromUnits(
			this.units.map(x => x.get_normalized(ruleset.mods_prefixal_order, ruleset.mods_combining_order, ruleset.mods_suffixal_order)),
			this.#raw
		)
	}

	is_normalized(ruleset: Ruleset) {
		let norm = this.get_normalized(ruleset)
		if (norm.units.length !== this.units.length) return false
		return this.units.every( (unit, i) => unit.eq(norm.units[i]) )
	}

	get raw() {
		return this.units.map(x=>x.raw).join('')
	}
	
	static fromUnits(units: UnitSegment[], raw: string) {
		let res = new Segment(raw)
		res.units = units
		return res
	}
}

type RulesetModifiers = Map<string, Modifier>

/** The Ruleset parses .rule files in relation to a defined feature schema, and exposes a function to
  * featuralize a segment.
  */
export class Ruleset {
	base_characters: Map<string, BaseCharacter>
	mods_prefixal: RulesetModifiers
	mods_combining: RulesetModifiers
	mods_suffixal: RulesetModifiers

	mods_prefixal_order: Map<string, number>
	mods_combining_order: Map<string, number>
	mods_suffixal_order: Map<string, number>

	feature_schema: FeatureSchema

	defaults: FeatureBundle
	aliases: Map<string, FeatureBundle>

	curr_line: number

	constructor(path: string, feature_schema: FeatureSchema) {
		this.feature_schema = feature_schema

		const raw: string = fs.readFileSync(path, 'utf8')
		const lines = raw.split('\n').map(x => x.trim())
		
		this.curr_line = 0

		this.base_characters = new Map()
		this.mods_prefixal = new Map()
		this.mods_combining = new Map()
		this.mods_suffixal = new Map()

		this.defaults = new FeatureBundle()
		this.aliases = new Map()

		const line_switch = {
			[RS_BASE]: this.parse_base,
			[RS_BASE_FULL]: this.parse_base,
			[RS_BASE_DERIVED]: this.parse_base_derived,
			[RS_BASE_DERIVED_FULL]: this.parse_base_derived,
			[RS_MOD_COMBINING]: this.parse_mod_combining,
			[RS_MOD_COMBINING_FULL]: this.parse_mod_combining,
			[RS_MOD_SUFFIX]: this.parse_mod_suffix,
			[RS_MOD_SUFFIX_FULL]: this.parse_mod_suffix,
			[RS_MOD_PREFIX]: this.parse_mod_prefix,
			[RS_MOD_PREFIX_FULL]: this.parse_mod_prefix
		}

		// handle hoisted metas
		for (let line_raw of lines) {
			if (line_raw.length === 0) continue
			const line = this.tokenize_line(line_raw)
			const cmd = line[0]

			const cmds = {
				'default': this.parse_meta_default,
				'alias': this.parse_meta_alias,
				'setalias': this.parse_meta_setalias,
				'block': this.parse_meta_block
			}

			if (cmd === RS_META) {
				const meta = line[1]
				if ( !(meta in cmds) ) throw new Error(`Unknown meta command ${meta}`)
				// @ts-ignore - doesn't realize meta must be in cmds (argh)
				cmds[meta].call(this, line.slice(2))
			}
			this.curr_line++
		}

		// don't validate aliases - defining a 'coronal' alias that doesn't set anterior etc. is fine
		// TODO validate defaults with noncomprehensive bundle validation
		//      ^ what does this mean?
		//      ^ validate defaults in the same way as aliases (anything defined must be reachable)

		// handle bulk of rules file (char / modifier defns)
		this.curr_line = 0
		for (let line_raw of lines) {
			if (line_raw.length === 0) continue
			const line = this.tokenize_line(line_raw)
			const cmd = line[0]

			if ( (!cmd) || cmd === RS_COMMENT || cmd === RS_META ) continue
			if ( !(cmd in line_switch) ) throw new Error(`Unknown command ${cmd})`)
			// @ts-ignore - doesn't realize cmd must be in line_switch
			line_switch[cmd].call(this, line.slice(1))
			this.curr_line++
		}

		// now that we've loaded everything, generate orders so we can normalize with sort()
		this.mods_prefixal_order = this.get_normalization_order(this.mods_prefixal)
		this.mods_combining_order = this.get_normalization_order(this.mods_combining)
		this.mods_suffixal_order = this.get_normalization_order(this.mods_suffixal)
	}

	// TODO errors thrown from ruleset should really use this
	private err(str: string): never {
		throw new Error(`${str} (${this.curr_line})`)
	}

	private parse_meta_default(line: string[]) {
		const PARSE_ERROR = new Error(`Invalid default defn: ${line.join(' ')}`)
		if (line.length < 3) throw PARSE_ERROR
		const val = line.shift()
		if (!val) throw PARSE_ERROR
		if (line.shift() !== ':') throw PARSE_ERROR

		for (let feature_name of line) {
			let feature_obj = this.feature_schema.features_by_name.get(feature_name)
			if (!feature_obj) throw new Error(`Nonexistent feature ${feature_name} in default defn: ${line.join(' ')}`)
			let feature_val = this.parse_feature_value(val)
			if (!feature_obj.values[feature_val]) throw new Error(`Feature ${feature_name} in default defn doesn't have value ${feature_val}: ${line.join(' ')}`)
			this.defaults.set(feature_name, feature_val)
		}
	}

	private parse_meta_alias(line: string[]) {
		const PARSE_ERROR = new Error(`Invalid alias defn: ${line.join(' ')}`)
		if (line.length < 3) throw PARSE_ERROR
		const alias_name = line.shift()
		if (!alias_name) throw PARSE_ERROR
		if (line.shift() !== ':') throw PARSE_ERROR

		let bundle = this.parse_feature_list(line, true)
		// TODO some kind of validation here
		// TODO either merge or error if already exists
		this.aliases.set(alias_name, bundle)
	}

	private parse_meta_setalias(line: string[]) {
		// TODO
		// what is this even for?
	}

	private parse_meta_block(line: string[]) {
		throw new Error("block isn't supported yet - wait for v2 or use alias")
	}

	private parse_base(line: string[]) {
		const PARSE_ERROR = new Error(`Invalid base defn: ${line.join(' ')}`)

		const base_char = line.shift()
		if (!base_char) throw PARSE_ERROR
		if (this.base_characters.has(base_char)) throw new Error(`Duplicate base defn: ${line.join(' ')}`)
		if (line.shift() !== ':') throw PARSE_ERROR
		if (line.length === 0) throw PARSE_ERROR
		const features = this.parse_feature_list(line, true)
		this.feature_schema.validate_bundle(features, line.join(' '))

		this.base_characters.set(base_char, {
			klass: 'base',
			glyph: base_char,
			features
		})
	}

	// What is a derived base?
	private parse_base_derived(line: string[]) {
		throw new Error("derived bases aren't supported yet - wait for v2 or use aliases")
	}

	// well, I understand why lisp people talk about macros now
	private _parse_mod(line: string[], klass: "combining" | "prefixal" | "suffixal") {
		const PARSE_ERROR = new Error(`Invalid combining diacritic defn: ${line.join(' ')}`)

		let glyph = line.shift()
		if (!glyph) throw PARSE_ERROR
		glyph = glyph.replace('◌','').replace('0','')
		if (glyph.length === 0) throw PARSE_ERROR

		let match_raw: string[] = []
		let match_fval = line.shift()
		while (match_fval !== ':') {
			if (match_fval === undefined) throw PARSE_ERROR
			match_raw.push(match_fval)
			match_fval = line.shift()
		}
		if (match_raw.length === 0) throw PARSE_ERROR

		// already consumed the colon
		let match = this.parse_feature_list(match_raw)
		let patch = this.parse_feature_list(line)

		if (!this[`mods_${klass}`].has(glyph)) {
			this[`mods_${klass}`].set(glyph, {
				klass,
				glyph,
				rules: new Map()
			})
		}

		this[`mods_${klass}`].get(glyph)!.rules.set(match, patch)
	}

	private parse_mod_combining(line: string[]) {
		this._parse_mod(line, "combining")
	}

	private parse_mod_suffix(line: string[]) {
		this._parse_mod(line, "suffixal")
	}

	private parse_mod_prefix(line: string[]) {
		this._parse_mod(line, "prefixal")
	}

	private tokenize_line(line_raw: string) {
		// TODO should replace all whitespace because what if you have weird Unicode spaces
		// TODO should handle mid-line comments here
		//      ^ doesn't this handle mid-line comments already?
		// TODO get a test suite
		line_raw = line_raw.split('#')[0]
		return line_raw.replace('\t', ' ').split(' ').filter(x => x !== '').map(x => x.trim())
	}

	// This function translates binary longhand for feature values (and could stand to have a better name)
	private parse_feature_value(fname: string): string {
		if (fname === RS_FVAL_FALSE_FULL) return RS_FVAL_FALSE
		if (fname === RS_FVAL_TRUE_FULL) return RS_FVAL_TRUE
		if (fname === RS_FVAL_NULL_FULL) return RS_FVAL_NULL
		return fname
	}

	private parse_feature_list(features: string[], use_defaults = false): FeatureBundle {
		let bundle = new FeatureBundle(use_defaults ? [...this.defaults] : [])
		for (let f of features) {
			// TODO handle alias references
			// ^ what does this mean?
			let res = f[0] === RS_ALIAS ? this.parse_alias(f) : this.parse_feature(f) 
			for (let k of res.keys()) bundle.set(k, res.get(k) as string)
		}
		return bundle
	}

	private parse_alias(aliasname: string): FeatureBundle {
		let res = this.aliases.get(aliasname.slice(1))
		if (res === undefined) throw new Error(`Unknown alias ${aliasname}`)
		return res
	}

	// parse feature + value declaration, e.g. anterior:false or -anterior
	// TODO support commas (once featural contours are supported)
	private parse_feature(fname_raw: string): FeatureBundle {
		const fname_arr = fname_raw.split(':') as [string] | [string, string] | [] // Typescript will complain if we don't do `| []`, but it's fine with the other length check
		if (fname_arr.length > 2 || fname_arr.length === 0) throw new Error(`Invalid feature assignment: ${fname_raw}`)

		let fname: string
		let fval: string
		if (fname_arr.length === 1) { // binary featureset shorthand: +feature / -feature / 0feature
			// It looks like it's technically possible to define arbitrary single-char features! This doesn't mean it's a good idea, however.
			fval = fname_arr[0][0]
			fname = fname_arr[0].slice(1)
		} else if (fname_arr.length === 2) { // feature:value
			fname = fname_arr[0]
			fval = this.parse_feature_value(fname_arr[1])
		} else {
			throw new Error(`Invalid feature + value combination ${fname_raw}`)
		}

		// make sure the feature exists and has the value
		let fobj = this.feature_schema.features_by_name.get(fname)
		if (!fobj) this.err(`Nonexistent feature in ${fname_raw}: ${fname}`)
		if (!fobj.values.hasOwnProperty(fval)) throw new Error(`Feature ${fname} doesn't have value ${fval}`)

		let res = new FeatureBundle()
		res.set(fobj.name, fval)
		return res
	}

	// -----------------------------
	// -- Segment featuralization --
	// -----------------------------

	// Get a numeric ordering of a diacritic class for use with sort().
	private get_normalization_order(m: Map<string, unknown>) {
		return new Map([...m.keys()].map( (str, i) => [str, i] ) )
	}

	// Returns *non-normalized* parsed/tokenized segment.
	private parse_segment(segment_raw: string): Segment {
		let segment: Segment = new Segment(segment_raw)
		
		// Read prefixal characters first
		var {matches, remainder} = greedy_match(segment_raw, this.mods_prefixal)
		segment.add_prefixes(matches)

		do {
			var last_remainder_length = remainder.length
			var {matches, remainder} = greedy_match(remainder, this.base_characters)
			let bases = matches // If we read multiple bases, there were no outstanding modifiers.
			for (let b of bases) segment.add_base(b)
			var {matches, remainder} = greedy_match(remainder, this.mods_combining)
			segment.add_combinings(matches)
			var {matches, remainder} = greedy_match(remainder, this.mods_suffixal)
			segment.add_suffixes(matches)
		} while (last_remainder_length !== remainder.length)
		
		if (segment.base_count === 0) throw new Error(`No base char found in segment ${segment}`)
		if (remainder.length > 0) throw new Error(`Unable to fully featuralize segment ${segment} - remainder ${remainder}`)

		return segment
	}

	private modify_bundle(bundle: FeatureBundle, patch: FeatureBundle) {
		let new_bundle = new FeatureBundle(bundle)
		for (let [feature_name, value] of patch) {
			new_bundle.set(feature_name, value)
		}
		return new_bundle
	}

	private apply_rule(rule: ModifierRule, bundle: FeatureBundle, rule_raw: string, segment_raw: string) {
		let found_match = false
		var found_rhs = new FeatureBundle()
		for (let [lhs, rhs] of rule) {
			if ( [...lhs].every( ([feature_name, value]) => bundle.get(feature_name) === value ) ) {
				if (found_match) throw new Error(`Rule ${rule_raw} has multiple matches for ${segment_raw}`)
				found_match = true
				found_rhs = rhs
			}
		}
		if (!found_match) return bundle
		return this.modify_bundle(bundle, found_rhs)
	}

	private featuralize_unit(unit: UnitSegment) {
		let base_character = this.base_characters.get(unit.base)
		if (base_character === undefined) throw new Error(`Unknown base character ${unit.base}`)
		let bundle = base_character.features

		for (let type of ['prefixal', 'combining', 'suffixal'] as const) {
			let diacritics = unit[`${type}_modifiers`] as SegmentModifiers
			let mods = this[`mods_${type}`] as RulesetModifiers

			for (let diacritic of diacritics) {
				let mod = mods.get(diacritic)
				if (mod === undefined) throw new Error(`Undefined rule for diacritic ${diacritic}`)
				bundle = this.apply_rule(mod.rules, bundle, mod.glyph, unit.toString())
			}
		}

		return bundle
	}

	// TODO:
	// - handle segments composed of >1 UnitSegment
	//   - have some kind of feature folding, or figure out how feature folding should be defined or whatever
	//     Feature folding should probably be handled separately - there's no one true way to do it.
	//     Maybe a feature folding module or definition. Needs to be able to handle non-binary feature models as well...
	//     (for example, /ai̯/ is a low central to high front diphthong)
	//     Also handle IPHON usage where we don't double diacritics, so /a̤i̯/ is breathy the whole way through but not written like it
	//     (Or possibly we should just drop the usage. How should /a̤a̰/ (chon1284-1) be handled? Possibly this is a concern for the
	//     feature model, though.)
	featuralize(segment_raw: string) {
		// console.log('trying to parse', segment_raw, string_to_codepoints(segment_raw))
		let segment = this.parse_segment(segment_raw)

		// Rudimentary feature folding.
		const features_arr: FeatureBundle[] = segment.units.map( unit => this.featuralize_unit(unit) )
		
		const features = TemporalFeatureBundle.fromArray(features_arr)

		if (!segment.is_normalized(this)) {
			let norm = segment.get_normalized(this)
			warn(`${segment} not normalized: normal form ${norm}`)
			// console.log('trying to featuralize normalized', norm.raw, string_to_codepoints(norm.raw))
			if ( !features.eq(this.featuralize(norm.raw)) ) {
				warn(`  Normalization affects featuralization! This is probably Very Bad.`)
			}
		}

		return features
	}
}


// If we have a multichar glyph, like IPA kp or ts or X-SAMPA r\`, we want to match the whole thing.
// But if we hit a start value where we can't match anything, just terminate:
//   everything before the remainder must be matched.
// Completely naive and unoptimized implementation. Segments should be pretty short, so this shouldn't matter.
function greedy_match(str: string, container: Set<string> | Map<string, unknown>) {
	var set: Set<string>
	if (container instanceof Set) {
		set = container
	} else if (container instanceof Map) {
		set = new Set(container.keys())
	} else {
		throw new Error("Invalid type for greedy_match")
	}

	let res: Set<string> = new Set()

    let max_known_end = 0
	for (let start = 0; start < str.length; start++) {
		max_known_end = start
		for (let end = start+1; end <= str.length; end++) {
			if ( set.has( str.slice(start, end) ) ) {
				max_known_end = end
			}
		}
		if (max_known_end > start) {
			res.add( str.slice(start, max_known_end) )
            res.add(`${str.slice(start, max_known_end)}`)
			start = max_known_end - 1
		} else {
			break
		}
	}

	return {
		matches: res,
		remainder: str.slice(max_known_end)
	}
}