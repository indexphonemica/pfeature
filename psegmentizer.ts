import { FeatureBundle } from './feature_schema'
import { Ruleset } from './ruleset'
import * as fs from 'fs'

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
            this.segments_featuralized.set(segment_raw, this.ruleset.featuralize(segment))
        }
    }

    write(_path: string) {
        // TODO output to actual file
        for (let [k, v] of this.segments_featuralized) {
            console.log(k, v)
        }
    }
}