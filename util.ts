/** Test two sets for equality. Cares about insertion order; doesn't try to recurse. */
export function set_eq(s1: Set<unknown>, s2: Set<unknown>) {
    if (s1.size !== s2.size) return false
    let s1_arr = [...s1]
    let s2_arr = [...s2]
    for (let i = 0; i < s1_arr.length; i++) {
        if (s1_arr[i] !== s2_arr[i]) return false
    }
    return true
}

let warnings: string[] = []
/** Add a warning to the `warnings` array, which is printable with `print_warnings()`. */
export function warn(txt: string) {
    warnings.push(txt)
}
export function print_warnings() {
    for (let i of warnings) console.warn(i) // TODO should probably write to file instead
}

export function string_to_codepoints(s: string) {
    let res: string[] = []
    for (let i = 0; i < s.length; i++) {
        const codepoint = s.codePointAt(i)!
        if (codepoint > 0xFFFF) i++ // skip surrogate
        res.push( codepoint.toString(16).padStart(4, '0').toUpperCase() )
    }
    return res
}