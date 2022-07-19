import { FeatureBundle } from './feature_schema'
import { Ruleset } from './ruleset'
import * as fs from 'fs'

/** The Psegmentizer is responsible for loading lists of segments and telling the Ruleset to featuralize each one.
 * Someday it will also generate statistics for the whole segment list, for example to print warnings for distinct
 *   segments with identical featuralizations. */
export class Psegmentizer {
    segments_raw: string
    segments_featuralized: Map<string, FeatureBundle>
    ruleset: Ruleset

    constructor (path: string, ruleset: Ruleset) {
        this.ruleset = ruleset

        this.segments_raw = fs.readFileSync(path, 'utf8')
        this.segments_featuralized = new Map()

        for (let segment_raw of this.segments_raw.split('\n')) {
            let segment = segment_raw.trim()
            if (segment.length === 0) continue
            this.segments_featuralized.set(segment, this.ruleset.featuralize(segment))
        }
    }

    /** Writes the list of featuralized segments to a file. */
    write(_path: string) {
        // TODO output to actual file
        for (let [k, v] of this.segments_featuralized) {
            console.log(k, v)
        }
    }
}