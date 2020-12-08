import { BaseCharacter, FeatureBundle, FeatureSchema, FeatureValue, Modifier } from './featuralize'
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

// aliases for binary feature support
const FALSES = new Set( ['-', 'false'] )
const TRUES = new Set( ['+', 'true'] )

class Ruleset {
	base_characters: Map<string, BaseCharacter>
	mods_combining: Map<string, Modifier>
	mods_prefixal: Map<string, Modifier>
	mods_suffixal: Map<string, Modifier>

	feature_schema: FeatureSchema

	defaults: FeatureBundle
	aliases: Map<string, FeatureBundle>

	constructor(path: string, feature_schema: FeatureSchema) {
		this.feature_schema = feature_schema

		const raw: string = fs.readFileSync(path, 'utf8')
		const lines = raw.split('\n').map(x => x.trim()).filter(x => x.length > 0)

		this.base_characters = new Map()
		this.mods_combining = new Map()
		this.mods_prefixal = new Map()
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

		for (let line_raw of lines) {
			const line = this.tokenize_line(line_raw)
			const cmd = line[0]

			if ( (!cmd) || cmd === RS_COMMENT || cmd === RS_META ) continue
			if ( !(cmd in line_switch) ) throw new Error(`Unknown command ${cmd})`)
			// @ts-ignore - doesn't realize cmd must be in line_switch
			line_switch[cmd](line.slice(1))
		}
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
		this.aliases.set(alias_name, bundle)
	}

	private parse_meta_block(line: string[]) {
		throw new Error("block isn't supported yet - wait for v2 or use alias")
	}

	private parse_base(line: string[]) {

	}

	private parse_base_derived(line: string[]) {

	}

	private parse_mod_combining(line: string[]) {

	}

	private parse_mod_suffix(line: string[]) {

	}

	private parse_mod_prefix(line: string[]) {

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
			let res = this.parse_feature(f)
			for (let k of res.keys()) bundle.set(k, res.get(k) as string)
		}
		return bundle
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
}


function parse_ruleset(path: string, feature_schema: FeatureSchema) {

	// const parse_line = {
	// 	[RS_META]: handle_meta,
	// 	[RS_BASE]: handle_base,
	// 	[RS_BASE_DERIVED]: handle_base_derived,
	// 	[RS_MOD_COMBINING]: handle_mod_combining,
	// 	[RS_MOD_SUFFIX]: handle_mod_suffix,
	// 	[RS_MOD_PREFIX]: handle_mod_prefix
	// }


}