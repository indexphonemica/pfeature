import { BaseCharacter, FeatureSchema, Modifier } from './featuralize'
import * as fs from 'fs'

const RS_COMMENT = '#'
const RS_META = '__meta'

const RS_BASE = '='
const RS_BASE_DERIVED = '=>'

const RS_MOD_COMBINING = '=='
const RS_MOD_SUFFIX = '=+'
const RS_MOD_PREFIX = '=-'

// aliases for binary feature support
const FALSES = new Set( ['-', 'false'] )
const TRUES = new Set( ['+', 'true'] )

class Ruleset {
	base_characters: Map<string, BaseCharacter>
	mods_combining: Map<string, Modifier>
	mods_prefixal: Map<string, Modifier>
	mods_suffixal: Map<string, Modifier>

	constructor(path: string, feature_schema: FeatureSchema) {
		const raw: string = fs.readFileSync(path, 'utf8')
		const lines = raw.split('\n').map(x => x.trim()).filter(x => x.length > 0)

		this.base_characters = new Map()
		this.mods_combining = new Map()
		this.mods_prefixal = new Map()
		this.mods_suffixal = new Map()

		const line_switch = {
			[RS_META]: this.parse_meta,
			[RS_BASE]: this.parse_base,
			[RS_BASE_DERIVED]: this.parse_base_derived,
			[RS_MOD_COMBINING]: this.parse_mod_combining,
			[RS_MOD_SUFFIX]: this.parse_mod_suffix,
			[RS_MOD_PREFIX]: this.parse_mod_prefix
		}

		for (let line_raw of lines) {
			const line = line_raw.replace('\t', ' ').split(' ').map(x => x.trim()) // tokenize
			const cmd = line[0]

			if ( (!cmd) || cmd === RS_COMMENT ) continue
			if ( !(cmd in line_switch) ) throw new Error(`Unknown command ${cmd})`)
			// @ts-ignore
			line_switch[cmd](line.slice(1))
		}
	}

	parse_meta(line: string[]) {

	}

	parse_base(line: string[]) {

	}

	parse_base_derived(line: string[]) {

	}

	parse_mod_combining(line: string[]) {

	}

	parse_mod_suffix(line: string[]) {

	}

	parse_mod_prefix(line: string[]) {

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