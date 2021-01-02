// cares about insertion order, doesn't try to recurse
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
export function warn(txt: string) {
    warnings.push(txt)
}
export function print_warnings() {
    for (let i of warnings) console.log(i) // TODO should probably write to file instead
}