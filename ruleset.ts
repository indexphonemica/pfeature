import { BaseCharacter, FeatureBundle, FeatureSchema, FeatureValue, Modifier } from './feature_schema'
import * as fs from 'fs'

const RS_COMMENT = '#'
const RS_META = '__meta'

const RS_BASE = '='
const RS_BASE_FULL = 'base'
const RS_BASE_DERIVED = '*='
const RS_BASE_DERIVED_FULL = 'derive'

const RS_MOD_COMBINING = '=='
const RS_MOD_COMBINING_FULL = 'combin'
const RS_MOD_SUFFIX = '=+'
const RS_MOD_SUFFIX_FULL = 'suffix'
const RS_MOD_PREFIX = '=-'
const RS_MOD_PREFIX_FULL = 'prefix'

const RS_ALIAS = '*' // must be one char since we check str[0]

// aliases for binary feature support
const FALSES = new Set( ['-', 'false'] )
const TRUES = new Set( ['+', 'true'] )

class UnitSegment {
	base: string
	prefixal_modifiers: Set<string>
	combining_modifiers: Set<string>
	suffixal_modifiers: Set<string>

	constructor(props: {
		base: string, 
		prefixal_modifiers: Set<string>, 
		combining_modifiers: Set<string>, 
		suffixal_modifiers: Set<string> 
	}) {
		this.base = props.base
		this.prefixal_modifiers = props.prefixal_modifiers
		this.combining_modifiers = props.combining_modifiers
		this.suffixal_modifiers = props.suffixal_modifiers
	}

	toString() {
		const prefixes = [...this.prefixal_modifiers].join(',')
		const combinings = [...this.combining_modifiers].map(x => `◌${x}`).join(',')
		const suffixes = [...this.suffixal_modifiers].join(',')
		return `(${prefixes} ${this.base} ${combinings} ${suffixes})`
	}
}

class MergeSet<T> extends Set<T> {
	constructor(...things: T[]) {
		super()
		this.merge(...things)
	}

	merge(...things: T[]) {
		for (let thing of things) {
			this.add(thing)
		}
	}
}

function merge<T>(s: Set<T>, ...ts: T[]) {
	let ns: Set<T> = new Set(s)
	for (let t of ts) ns.add(t)
	return ns
}

class Segment {
	units: UnitSegment[]
	readonly str: string
	prefix_queue: Set<string>

	constructor(raw: string) {
		this.str = raw
		this.units = []
		this.prefix_queue = new Set()
	}

	get curr() {
		return this.units[this.units.length-1]
	}

	get base_count() {
		return this.units.length
	}

	add_prefixes(prefixes: Set<string>) {
		if (this.units.length === 0) {
			this.prefix_queue = merge(this.prefix_queue, ...prefixes)
		} else {
			this.curr.prefixal_modifiers = merge(this.curr.prefixal_modifiers, ...prefixes)
		}
	}

	add_base(base: string) {
		let prefixes: Set<string> = (this.units.length === 0) ? this.prefix_queue : new Set()

		this.units.push(new UnitSegment({
			prefixal_modifiers: prefixes,
			base,
			combining_modifiers: new Set(),
			suffixal_modifiers: new Set()
		}))
	}

	add_combinings(combinings: Set<string>) {
		this.curr.combining_modifiers = merge(this.curr.combining_modifiers, ...combinings)
	}

	add_suffixes(suffixes: Set<string>) {
		this.curr.suffixal_modifiers = merge(this.curr.suffixal_modifiers, ...suffixes)
	}

	toString() {
		return `${this.str} ( ${this.units.map(x => x.toString())} )`
	}
}

export class Ruleset {
	base_characters: Map<string, BaseCharacter>
	mods_prefixal: Map<string, Modifier>
	mods_combining: Map<string, Modifier>
	mods_suffixal: Map<string, Modifier>

	mods_prefixal_order: Map<string, number>
	mods_combining_order: Map<string, number>
	mods_suffixal_order: Map<string, number>

	feature_schema: FeatureSchema

	defaults: FeatureBundle
	aliases: Map<string, FeatureBundle>

	constructor(path: string, feature_schema: FeatureSchema) {
		this.feature_schema = feature_schema

		const raw: string = fs.readFileSync(path, 'utf8')
		const lines = raw.split('\n').map(x => x.trim()).filter(x => x.length > 0)

		this.base_characters = new Map()
		this.mods_prefixal = new Map()
		this.mods_combining = new Map()
		this.mods_suffixal = new Map()

		this.defaults = new Map()
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
				cmds[meta](line.slice(2))
			}
		}

		// don't validate aliases - defining a 'coronal' alias that doesn't set anterior etc. is fine
		// but do validate defaults, now that they're loaded
		this.feature_schema.validate_bundle(this.defaults)

		// handle bulk of rules file (char / modifier defns)
		for (let line_raw of lines) {
			const line = this.tokenize_line(line_raw)
			const cmd = line[0]

			if ( (!cmd) || cmd === RS_COMMENT || cmd === RS_META ) continue
			if ( !(cmd in line_switch) ) throw new Error(`Unknown command ${cmd})`)
			// @ts-ignore - doesn't realize cmd must be in line_switch
			line_switch[cmd](line.slice(1))
		}

		// now that we've loaded everything, generate orders so we can normalize with sort()
		this.mods_prefixal_order = this.get_normalization_order(this.mods_prefixal)
		this.mods_combining_order = this.get_normalization_order(this.mods_combining)
		this.mods_suffixal_order = this.get_normalization_order(this.mods_suffixal)
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
			let feature_val = this.parse_feature_name(val)
			if (!feature_obj.values[val]) throw new Error(`Feature ${feature_name} in default defn doesn't have value ${val}: ${line.join(' ')}`)
			this.defaults.set(feature_name, val)
		}
	}

	private parse_meta_alias(line: string[]) {
		const PARSE_ERROR = new Error(`Invalid alias defn: ${line.join(' ')}`)
		if (line.length < 3) throw PARSE_ERROR
		const alias_name = line.shift()
		if (!alias_name) throw PARSE_ERROR
		if (line.shift() !== ':') throw PARSE_ERROR

		let bundle = this.parse_feature_list(line)
		this.feature_schema.validate_bundle(bundle, `alias ${alias_name}`)
		// TODO either merge or error if already exists
		this.aliases.set(alias_name, bundle)
	}

	private parse_meta_setalias(line: string[]) {
		// TODO
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
		const features = this.parse_feature_list(line)
		this.feature_schema.validate_bundle(features)

		this.base_characters.set(base_char, {
			klass: 'base',
			glyph: base_char,
			features
		})
	}

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

		// @ts-ignore - I know what I'm about, son (TS can't resolve string interpolation and know that the property always exists)
		if (!this[`mods_${klass}`].has(glyph)) {
			// @ts-ignore
			this[`mods_${klass}`].set(glyph, {
				klass,
				glyph,
				rules: new Map()
			})
		}

		// the point of this trash fire is to allow the same string-interpolated property access trick as above
		// without ts-ignoring the whole line
		(((this as any)[`mods_${klass}`] as Map<string, Modifier>).get(glyph) as Modifier).rules.set(match, patch)
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
		return line_raw.replace('\t', ' ').split(' ').map(x => x.trim())
	}

	// could stand to have a better name - handle binary longhand
	private parse_feature_name<T extends string | undefined>(fname: T): T extends string ? string : undefined {
		if (fname === 'false') return '-' as any // sigh https://github.com/microsoft/TypeScript/issues/24929
		if (fname === 'true') return '+' as any
		if (fname === 'null') return '0' as any
		return fname as any
	}

	private parse_feature_list(features: string[]): FeatureBundle {
		let bundle: FeatureBundle = new Map()
		for (let f of features) {
			// TODO handle alias references
			let res = f[0] === RS_ALIAS ? this.parse_alias(f) : this.parse_feature(f) 
			for (let k of res.keys()) bundle.set(k, res.get(k) as string)
		}
		return bundle
	}

	private parse_alias(aliasname: string): FeatureBundle {
		let res = this.aliases.get(aliasname)
		if (res === undefined) throw new Error(`Unknown alias ${res}`)
		return res
	}

	// parse feature + value declaration, e.g. anterior:false or -anterior
	private parse_feature(fname_raw: string): FeatureBundle {
		const fname_arr = fname_raw.split(':')
		if (fname_arr.length > 2 || fname_arr.length === 0) throw new Error(`Invalid feature assignment: ${fname_raw}`)

		let fname: string
		let fval: string
		if (fname_arr.length === 1) { // binary featureset shorthand: +feature / -feature / 0feature
			fname = fname_arr[0][1]
			fval = fname_arr[0].slice(1)
		} else { // length 2 - feature:value
			fname = fname_arr[0]
			fval = this.parse_feature_name(fname_arr[1])
		}

		// make sure the feature exists and has the value
		let fobj = this.feature_schema.features_by_name.get(fname)
		if (!fobj) throw new Error(`Nonexistent feature: ${fname}`)
		if (!fobj.values.hasOwnProperty(fval)) throw new Error(`Feature ${fname} doesn't have value ${fval}`)

		let res: FeatureBundle = new Map()
		res.set(fobj.name, fval)
		return res
	}

	private _featuralize(segment: UnitSegment): FeatureBundle {
		// Need to take some care here to handle multiple bases.
		// As a first pass, I think this would be reasonable:
		// - Affixal characters affect the whole segment.
		// - Combining characters affect only the base component.
		// Will also need some kind of coalescence rule.


	}

	// Get a numeric ordering of a diacritic class for use with sort().
	private get_normalization_order(m: Map<string, unknown>) {
		return new Map([...m.keys()].map( (str, i) => [str, i] ) )
	}

	featuralize_segment(segment_raw: string): Segment {
		let segment: Segment = new Segment(segment_raw)
		// -- Tokenize --
		
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
            console.log(`${start} ${end} ${str.slice(start, end)}`)
			if ( set.has( str.slice(start, end) ) ) {
                console.log(`found ${str.slice(start, end)}`)
				max_known_end = end
			}
		}
		if (max_known_end > start) {
			res.add( str.slice(start, max_known_end) )
            res.add(`${str.slice(start, max_known_end)}`)
            console.log(`here ${start} ${max_known_end} ${JSON.stringify(res.keys())}`)
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