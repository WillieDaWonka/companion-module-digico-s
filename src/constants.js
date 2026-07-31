/**
 * The DiGiCo S-Series OSC command set.
 *
 * Transcribed from the OSC Commands table exported from a physical S-Series console
 * running the 60-input / 24-bus channel count upgrade, cross-checked against the
 * S-Series V3.0.9 release notes (section 1.5, "OSC control").
 *
 * `path` templates use `{channel}`, `{band}` and `{send}` placeholders exactly as the
 * console presents them. Band indices are ZERO-BASED on the console: the console help
 * states the 4th EQ band gain of input channel 2 is `/channel/2/eq/3/gain`.
 */

export const CHANNEL_MODE = {
	EXPANDED: 'expanded_60_24',
	STANDARD: 'standard_48_16',
}

/**
 * How booleans are put on the wire.
 *
 * The console's exported table calls these `false/true`, which in OSC means the `T`/`F`
 * type tags - but DiGiCo's implementation has been reported to accept the literal strings
 * `"true"`/`"false"` as well, and the OSC Commands editor can normalise booleans to 0/1.
 * Rather than pick one and hope, AUTO watches what the console itself sends and matches it.
 */
export const BOOL_FORMAT = {
	AUTO: 'auto',
	TRUE_FALSE: 'truefalse',
	INT: 'int',
	STRING: 'string',
}

/** Map an OSC argument type seen from the console onto the format that produced it. */
export function boolFormatFromOscType(type) {
	if (type === 'T' || type === 'F') return BOOL_FORMAT.TRUE_FALSE
	if (type === 'i') return BOOL_FORMAT.INT
	if (type === 's') return BOOL_FORMAT.STRING
	return undefined
}

/**
 * Resolve the channel/bus layout for a console mode.
 *
 * Per the V3.0.9 release notes: reverting a 60/24 console to 48/16 removes input
 * channels 49-60 and busses 17-24. Busses map linearly onto OSC numbers 70-93, so
 * losing busses 17-24 removes OSC 86-93 - i.e. the top eight Group slots.
 */
export function getChannelModel(mode) {
	const expanded = mode !== CHANNEL_MODE.STANDARD
	return {
		expanded,
		inputCount: expanded ? 60 : 48,
		busCount: expanded ? 24 : 16,
		inputs: { first: 1, last: expanded ? 60 : 48 },
		aux: { first: 70, last: 79 },
		groups: { first: 80, last: expanded ? 93 : 85 },
		matrix: { first: 100, last: 107 },
		controlGroups: { first: 110, last: 119 },
		master: 120,
	}
}

/**
 * Enumerate every addressable channel for a console mode.
 *
 * Aux/Group labels reflect a DEFAULT session. Each S-Series bus can be switched
 * between Aux and Group mode, and doing so does NOT change its OSC number - so a slot
 * labelled "Aux 3" here addresses whatever that bus currently is.
 *
 * @returns {Array<{osc: number, slug: string, label: string}>}
 */
export function buildChannelDescriptors(model) {
	const list = []
	const push = (osc, slug, label) => list.push({ osc, slug, label })

	for (let i = model.inputs.first; i <= model.inputs.last; i++) {
		push(i, `input_${i}`, `Input ${i}`)
	}
	for (let i = model.aux.first; i <= model.aux.last; i++) {
		const n = i - model.aux.first + 1
		push(i, `aux_${n}`, `Aux ${n} (OSC ${i})`)
	}
	for (let i = model.groups.first; i <= model.groups.last; i++) {
		const n = i - 79
		push(i, `group_${n}`, `Group ${n} (OSC ${i})`)
	}
	for (let i = model.matrix.first; i <= model.matrix.last; i++) {
		const n = i - model.matrix.first + 1
		push(i, `matrix_${n}`, `Matrix ${n} (OSC ${i})`)
	}
	for (let i = model.controlGroups.first; i <= model.controlGroups.last; i++) {
		const n = i - model.controlGroups.first + 1
		push(i, `cg_${n}`, `Control Group ${n} (OSC ${i})`)
	}
	push(model.master, 'master', `Master Bus (OSC ${model.master})`)

	return list
}

/** Build the channel dropdown choices for a console mode. */
export function buildChannelChoices(model) {
	return buildChannelDescriptors(model).map((c) => ({ id: c.osc, label: c.label }))
}

/**
 * Send destinations.
 *
 * `{send}` in `/channel/{channel}/send/{send}/level` is the DESTINATION BUS OSC NUMBER,
 * not a 1..n send slot index. That is why the same command doubles as "Aux Send On/Off
 * **or Group Assign**" in the console's own command table - and it is the only reading
 * that can express assigning a channel to a control group (110-119) or the master bus
 * (120), which have no aux-send slot.
 */
export function buildSendChoices(model) {
	return buildChannelDescriptors(model)
		.filter((c) => c.osc >= model.aux.first)
		.map((c) => ({ id: c.osc, label: c.label }))
}

export const BAND_BASE = {
	ZERO: 'zero',
	ONE: 'one',
}

const EQ_BAND_LABELS = ['Band 1 (LF)', 'Band 2 (LMF)', 'Band 3 (HMF)', 'Band 4 (HF)']
const DYN_BAND_LABELS = ['Band 1 (Low / single-band)', 'Band 2 (Mid)', 'Band 3 (High)']

/**
 * Band choices, whose ids are the literal index sent over the wire.
 *
 * DiGiCo's own console help documents these as zero-based - it gives
 * `/Channel/2/EQ/3/gain` as the 4th EQ band gain of input channel 2 - so that is the
 * default. The option exists because it is the one fact in the command set where the
 * available sources disagree, and getting it wrong silently shifts every band by one.
 */
export function buildBandChoices(labels, bandBase) {
	const offset = bandBase === BAND_BASE.ONE ? 1 : 0
	return labels.map((label, index) => ({ id: index + offset, label }))
}

export const buildEqBandChoices = (bandBase) => buildBandChoices(EQ_BAND_LABELS, bandBase)
export const buildDynBandChoices = (bandBase) => buildBandChoices(DYN_BAND_LABELS, bandBase)

export const CATEGORY = {
	SNAPSHOT: 'Snapshots',
	INPUT: 'Channel Input',
	CHANNEL: 'Channel',
	EQ: 'Equaliser',
	DYN1: 'Dynamics 1',
	DYN2: 'Dynamics 2',
	SENDS: 'Aux Sends & Group Assign',
	CONSOLE: 'Console',
}

/**
 * Order categories appear in the action and feedback pickers. Alphabetical sorting would
 * put "Channel Input" above "Channel" and scatter the console utilities, so `sortName`
 * carries this order instead.
 */
const CATEGORY_ORDER = [
	CATEGORY.CHANNEL,
	CATEGORY.INPUT,
	CATEGORY.EQ,
	CATEGORY.DYN1,
	CATEGORY.DYN2,
	CATEGORY.SENDS,
	CATEGORY.SNAPSHOT,
	CATEGORY.CONSOLE,
]

/**
 * A sort key that keeps a parameter's variants together and in a sensible order:
 * category, then the parameter's position in the table, then set/adjust/fade.
 */
export function sortKey(param, variant = 0) {
	const category = String(CATEGORY_ORDER.indexOf(param.category)).padStart(2, '0')
	const index = String(PARAMETERS.findIndex((p) => p.id === param.id)).padStart(3, '0')
	return `${category}_${index}_${variant}`
}

/**
 * Every command in the console's OSC table.
 *
 * scope:  'global' | 'channel' | 'eqband' | 'dynband' | 'send'
 * kind:   'float' | 'int' | 'bool' | 'string' | 'trigger'
 * access: 'rw' | 'r' (console -> Companion only) | 'w' (Companion -> console only)
 */
export const PARAMETERS = [
	// --- Snapshots ------------------------------------------------------------
	{
		id: 'snapshot_fire',
		name: 'Fire Snapshot',
		path: '/digico/snapshots/fire',
		scope: 'global',
		kind: 'int',
		min: 0,
		max: 1000,
		step: 1,
		category: CATEGORY.SNAPSHOT,
		access: 'rw',
	},
	{
		id: 'snapshot_next',
		name: 'Next Snapshot',
		path: '/digico/snapshots/next',
		scope: 'global',
		kind: 'trigger',
		category: CATEGORY.SNAPSHOT,
		access: 'w',
	},
	{
		id: 'snapshot_previous',
		name: 'Previous Snapshot',
		path: '/digico/snapshots/previous',
		scope: 'global',
		kind: 'trigger',
		category: CATEGORY.SNAPSHOT,
		access: 'w',
	},

	// --- Channel input --------------------------------------------------------
	{
		id: 'input_trim',
		name: 'Input Trim',
		path: '/channel/{channel}/input/trim',
		scope: 'channel',
		kind: 'float',
		min: -40,
		max: 40,
		step: 0.5,
		unit: 'dB',
		category: CATEGORY.INPUT,
		access: 'rw',
	},
	{
		id: 'input_delay_time',
		name: 'Input Delay Time',
		path: '/channel/{channel}/input/delay/time',
		scope: 'channel',
		kind: 'float',
		min: 0,
		max: 0.682,
		step: 0.001,
		unit: 's',
		display: { unit: 'ms', scale: 1000 },
		category: CATEGORY.INPUT,
		access: 'rw',
	},
	{
		id: 'input_delay_enabled',
		name: 'Input Delay Enabled',
		path: '/channel/{channel}/input/delay/enabled',
		scope: 'channel',
		kind: 'bool',
		category: CATEGORY.INPUT,
		access: 'rw',
	},
	{
		id: 'digitube_enabled',
		name: 'DiGiTube Enabled',
		path: '/channel/{channel}/input/digitube/enabled',
		scope: 'channel',
		kind: 'bool',
		category: CATEGORY.INPUT,
		access: 'rw',
	},
	{
		id: 'digitube_bias',
		name: 'DiGiTube Bias',
		path: '/channel/{channel}/input/digitube/bias',
		scope: 'channel',
		kind: 'int',
		min: 0,
		max: 100,
		step: 1,
		category: CATEGORY.INPUT,
		access: 'rw',
	},
	{
		id: 'digitube_drive',
		name: 'DiGiTube Drive',
		path: '/channel/{channel}/input/digitube/drive',
		scope: 'channel',
		kind: 'float',
		min: 0.5,
		max: 50,
		step: 0.5,
		category: CATEGORY.INPUT,
		access: 'rw',
	},
	{
		id: 'input_width',
		name: 'Input Width',
		path: '/channel/{channel}/input/width',
		scope: 'channel',
		kind: 'float',
		min: -1,
		max: 1,
		step: 0.01,
		category: CATEGORY.INPUT,
		access: 'rw',
	},
	{
		id: 'input_balance',
		name: 'Input Balance',
		path: '/channel/{channel}/input/balance',
		scope: 'channel',
		kind: 'float',
		min: -1,
		max: 2,
		step: 0.01,
		category: CATEGORY.INPUT,
		access: 'rw',
	},
	{
		id: 'input_polarity',
		name: 'Input Polarity',
		path: '/channel/{channel}/input/polarity',
		scope: 'channel',
		kind: 'int',
		min: 0,
		max: 1,
		step: 1,
		category: CATEGORY.INPUT,
		access: 'rw',
		enumLabels: [
			{ id: 0, label: 'Normal' },
			{ id: 1, label: 'Inverted' },
		],
	},
	{
		id: 'input_gain_tracking',
		name: 'Input Gain Tracking',
		path: '/channel/{channel}/input/gain_tracking',
		scope: 'channel',
		kind: 'bool',
		category: CATEGORY.INPUT,
		access: 'rw',
	},
	{
		id: 'channel_name',
		name: 'Channel Name',
		path: '/channel/{channel}/input/name',
		scope: 'channel',
		kind: 'string',
		category: CATEGORY.INPUT,
		access: 'rw',
	},

	// --- Channel strip --------------------------------------------------------
	{
		id: 'fader',
		name: 'Fader Level',
		path: '/channel/{channel}/input/fader',
		scope: 'channel',
		kind: 'float',
		// The exported table gives -150..10, where -150 is the console's -inf. Fader
		// travel is presented as -90..+10, which is the useful working range; -90 dB is
		// silence for any practical purpose.
		min: -90,
		max: 10,
		step: 0.5,
		unit: 'dB',
		fadeable: true,
		negativeInfinityAtMin: true,
		category: CATEGORY.CHANNEL,
		access: 'rw',
	},
	{
		id: 'total_gain',
		name: 'Total Channel Gain',
		path: '/channel/{channel}/total/gain',
		scope: 'channel',
		kind: 'float',
		min: -150,
		max: 30,
		step: 0.5,
		unit: 'dB',
		category: CATEGORY.CHANNEL,
		access: 'r',
	},
	{
		id: 'pan',
		name: 'Pan',
		path: '/channel/{channel}/pan',
		scope: 'channel',
		kind: 'float',
		min: -1,
		max: 1,
		step: 0.01,
		fadeable: true,
		category: CATEGORY.CHANNEL,
		access: 'rw',
	},
	{
		id: 'mute',
		name: 'Mute',
		path: '/channel/{channel}/mute',
		scope: 'channel',
		kind: 'bool',
		category: CATEGORY.CHANNEL,
		access: 'rw',
	},
	{
		id: 'solo',
		name: 'Solo',
		path: '/channel/{channel}/solo',
		scope: 'channel',
		kind: 'bool',
		category: CATEGORY.CHANNEL,
		access: 'rw',
	},

	// --- Equaliser ------------------------------------------------------------
	{
		id: 'eq_enabled',
		name: 'EQ Enabled',
		path: '/channel/{channel}/eq/enabled',
		scope: 'channel',
		kind: 'bool',
		category: CATEGORY.EQ,
		access: 'rw',
	},
	{
		id: 'eq_highpass_frequency',
		name: 'EQ Highpass Frequency',
		path: '/channel/{channel}/eq/highpass/frequency',
		scope: 'channel',
		kind: 'float',
		min: 20,
		max: 20000,
		step: 1,
		unit: 'Hz',
		category: CATEGORY.EQ,
		access: 'rw',
	},
	{
		id: 'eq_highpass_enabled',
		name: 'EQ Highpass Enabled',
		path: '/channel/{channel}/eq/highpass/enabled',
		scope: 'channel',
		kind: 'bool',
		category: CATEGORY.EQ,
		access: 'rw',
	},
	{
		id: 'eq_lowpass_frequency',
		name: 'EQ Lowpass Frequency',
		path: '/channel/{channel}/eq/lowpass/frequency',
		scope: 'channel',
		kind: 'float',
		min: 20,
		max: 20000,
		step: 1,
		unit: 'Hz',
		category: CATEGORY.EQ,
		access: 'rw',
	},
	{
		id: 'eq_lowpass_enabled',
		name: 'EQ Lowpass Enabled',
		path: '/channel/{channel}/eq/lowpass/enabled',
		scope: 'channel',
		kind: 'bool',
		category: CATEGORY.EQ,
		access: 'rw',
	},
	{
		id: 'eq_band_frequency',
		name: 'EQ Band Frequency',
		path: '/channel/{channel}/eq/{band}/frequency',
		scope: 'eqband',
		kind: 'float',
		min: 20,
		max: 20000,
		step: 1,
		unit: 'Hz',
		category: CATEGORY.EQ,
		access: 'rw',
	},
	{
		id: 'eq_band_gain',
		name: 'EQ Band Gain',
		path: '/channel/{channel}/eq/{band}/gain',
		scope: 'eqband',
		kind: 'float',
		// The console's exported table prints this range as "18..18", which is not a
		// usable range for a symmetric bell gain. Treated as +/-18 dB.
		min: -18,
		max: 18,
		step: 0.5,
		unit: 'dB',
		category: CATEGORY.EQ,
		access: 'rw',
	},
	{
		id: 'eq_band_q',
		name: 'EQ Band Q',
		path: '/channel/{channel}/eq/{band}/q',
		scope: 'eqband',
		kind: 'float',
		min: 0.1,
		max: 20,
		step: 0.1,
		category: CATEGORY.EQ,
		access: 'rw',
	},
	{
		id: 'eq_band_dyn_threshold',
		name: 'EQ Band Dynamic Threshold',
		path: '/channel/{channel}/eq/{band}/dyn/threshold',
		scope: 'eqband',
		kind: 'float',
		min: -60,
		max: 0,
		step: 0.5,
		unit: 'dB',
		category: CATEGORY.EQ,
		access: 'rw',
	},
	{
		id: 'eq_band_dyn_ratio',
		name: 'EQ Band Dynamic Ratio',
		path: '/channel/{channel}/eq/{band}/dyn/ratio',
		scope: 'eqband',
		kind: 'float',
		min: 1,
		max: 10,
		step: 0.1,
		category: CATEGORY.EQ,
		access: 'rw',
	},
	{
		id: 'eq_band_dyn_attack',
		name: 'EQ Band Dynamic Attack',
		path: '/channel/{channel}/eq/{band}/dyn/attack',
		scope: 'eqband',
		kind: 'float',
		min: 0.0005,
		max: 0.1,
		step: 0.0005,
		unit: 's',
		display: { unit: 'ms', scale: 1000 },
		category: CATEGORY.EQ,
		access: 'rw',
	},
	{
		id: 'eq_band_dyn_release',
		name: 'EQ Band Dynamic Release',
		path: '/channel/{channel}/eq/{band}/dyn/release',
		scope: 'eqband',
		kind: 'float',
		min: 0.01,
		max: 10,
		step: 0.01,
		unit: 's',
		display: { unit: 'ms', scale: 1000 },
		category: CATEGORY.EQ,
		access: 'rw',
	},
	{
		id: 'eq_band_dyn_enabled',
		name: 'EQ Band Dynamic Enabled',
		path: '/channel/{channel}/eq/{band}/dyn/enabled',
		scope: 'eqband',
		kind: 'bool',
		category: CATEGORY.EQ,
		access: 'rw',
	},

	// --- Dynamics 1 -----------------------------------------------------------
	{
		id: 'dyn1_enabled',
		name: 'Dyn 1 Enabled',
		path: '/channel/{channel}/dyn1/enabled',
		scope: 'channel',
		kind: 'bool',
		category: CATEGORY.DYN1,
		access: 'rw',
	},
	{
		id: 'dyn1_mode',
		name: 'Dyn 1 Mode',
		path: '/channel/{channel}/dyn1/mode',
		scope: 'channel',
		kind: 'int',
		min: 0,
		max: 10,
		step: 1,
		category: CATEGORY.DYN1,
		access: 'rw',
	},
	{
		id: 'dyn1_crossover_low',
		name: 'Dyn 1 Sidechain Lowpass Filter',
		path: '/channel/{channel}/dyn1/crossover_low',
		scope: 'channel',
		kind: 'float',
		min: 20,
		max: 20000,
		step: 1,
		unit: 'Hz',
		category: CATEGORY.DYN1,
		access: 'rw',
	},
	{
		id: 'dyn1_crossover_high',
		name: 'Dyn 1 Sidechain Highpass Filter',
		path: '/channel/{channel}/dyn1/crossover_high',
		scope: 'channel',
		kind: 'float',
		min: 20,
		max: 20000,
		step: 1,
		unit: 'Hz',
		category: CATEGORY.DYN1,
		access: 'rw',
	},
	{
		id: 'dyn1_threshold',
		name: 'Dyn 1 Threshold',
		path: '/channel/{channel}/dyn1/{band}/threshold',
		scope: 'dynband',
		kind: 'float',
		min: -60,
		max: 0,
		step: 0.5,
		unit: 'dB',
		category: CATEGORY.DYN1,
		access: 'rw',
	},
	{
		id: 'dyn1_ratio',
		name: 'Dyn 1 Ratio',
		path: '/channel/{channel}/dyn1/{band}/ratio',
		scope: 'dynband',
		kind: 'float',
		min: 1,
		max: 50,
		step: 0.1,
		category: CATEGORY.DYN1,
		access: 'rw',
	},
	{
		id: 'dyn1_gain',
		name: 'Dyn 1 Makeup Gain',
		path: '/channel/{channel}/dyn1/{band}/gain',
		scope: 'dynband',
		kind: 'float',
		min: 0,
		max: 40,
		step: 0.5,
		unit: 'dB',
		category: CATEGORY.DYN1,
		access: 'rw',
	},
	{
		id: 'dyn1_attack',
		name: 'Dyn 1 Attack',
		path: '/channel/{channel}/dyn1/{band}/attack',
		scope: 'dynband',
		kind: 'float',
		min: 0.0005,
		max: 0.1,
		step: 0.0005,
		unit: 's',
		display: { unit: 'ms', scale: 1000 },
		category: CATEGORY.DYN1,
		access: 'rw',
	},
	{
		id: 'dyn1_release',
		name: 'Dyn 1 Release',
		path: '/channel/{channel}/dyn1/{band}/release',
		scope: 'dynband',
		kind: 'float',
		min: 0.005,
		max: 0.1,
		step: 0.005,
		unit: 's',
		display: { unit: 'ms', scale: 1000 },
		category: CATEGORY.DYN1,
		access: 'rw',
	},
	{
		id: 'dyn1_knee',
		name: 'Dyn 1 Knee',
		path: '/channel/{channel}/dyn1/{band}/knee',
		scope: 'dynband',
		kind: 'int',
		min: 0,
		max: 10,
		step: 1,
		category: CATEGORY.DYN1,
		access: 'rw',
	},
	{
		id: 'dyn1_listen',
		name: 'Dyn 1 Listen',
		path: '/channel/{channel}/dyn1/{band}/listen',
		scope: 'dynband',
		kind: 'bool',
		category: CATEGORY.DYN1,
		access: 'rw',
	},

	// --- Dynamics 2 -----------------------------------------------------------
	{
		id: 'dyn2_enabled',
		name: 'Dyn 2 Enabled',
		path: '/channel/{channel}/dyn2/enabled',
		scope: 'channel',
		kind: 'bool',
		category: CATEGORY.DYN2,
		access: 'rw',
	},
	{
		id: 'dyn2_mode',
		name: 'Dyn 2 Mode',
		path: '/channel/{channel}/dyn2/mode',
		scope: 'channel',
		kind: 'int',
		min: 0,
		max: 10,
		step: 1,
		category: CATEGORY.DYN2,
		access: 'rw',
	},
	{
		id: 'dyn2_gain',
		name: 'Dyn 2 Gain',
		path: '/channel/{channel}/dyn2/gain',
		scope: 'channel',
		kind: 'float',
		min: 0,
		max: 40,
		step: 0.5,
		unit: 'dB',
		category: CATEGORY.DYN2,
		access: 'rw',
	},
	{
		id: 'dyn2_threshold',
		name: 'Dyn 2 Threshold',
		path: '/channel/{channel}/dyn2/threshold',
		scope: 'channel',
		kind: 'float',
		min: -60,
		max: 0,
		step: 0.5,
		unit: 'dB',
		category: CATEGORY.DYN2,
		access: 'rw',
	},
	{
		id: 'dyn2_range',
		name: 'Dyn 2 Range',
		path: '/channel/{channel}/dyn2/range',
		scope: 'channel',
		kind: 'float',
		min: -90,
		max: 0,
		step: 0.5,
		unit: 'dB',
		category: CATEGORY.DYN2,
		access: 'rw',
	},
	{
		id: 'dyn2_ratio',
		name: 'Dyn 2 Ratio',
		path: '/channel/{channel}/dyn2/ratio',
		scope: 'channel',
		kind: 'float',
		min: 1,
		max: 50,
		step: 0.1,
		category: CATEGORY.DYN2,
		access: 'rw',
	},
	{
		id: 'dyn2_attack',
		name: 'Dyn 2 Attack',
		path: '/channel/{channel}/dyn2/attack',
		scope: 'channel',
		kind: 'float',
		min: 0.0005,
		max: 0.1,
		step: 0.0005,
		unit: 's',
		display: { unit: 'ms', scale: 1000 },
		category: CATEGORY.DYN2,
		access: 'rw',
	},
	{
		id: 'dyn2_hold',
		name: 'Dyn 2 Hold',
		path: '/channel/{channel}/dyn2/hold',
		scope: 'channel',
		kind: 'float',
		min: 0.002,
		max: 2,
		step: 0.002,
		unit: 's',
		display: { unit: 'ms', scale: 1000 },
		category: CATEGORY.DYN2,
		access: 'rw',
	},
	{
		id: 'dyn2_release',
		name: 'Dyn 2 Release',
		path: '/channel/{channel}/dyn2/release',
		scope: 'channel',
		kind: 'float',
		min: 0.005,
		max: 0.1,
		step: 0.005,
		unit: 's',
		display: { unit: 'ms', scale: 1000 },
		category: CATEGORY.DYN2,
		access: 'rw',
	},
	{
		id: 'dyn2_knee',
		name: 'Dyn 2 Knee',
		path: '/channel/{channel}/dyn2/knee',
		scope: 'channel',
		kind: 'int',
		min: 0,
		max: 10,
		step: 1,
		category: CATEGORY.DYN2,
		access: 'rw',
	},
	{
		id: 'dyn2_listen',
		name: 'Dyn 2 Listen',
		path: '/channel/{channel}/dyn2/listen',
		scope: 'channel',
		kind: 'bool',
		category: CATEGORY.DYN2,
		access: 'rw',
	},
	{
		id: 'dyn2_lowpass',
		name: 'Dyn 2 Lowpass Filter',
		path: '/channel/{channel}/dyn2/lowpass',
		scope: 'channel',
		kind: 'float',
		min: 20,
		max: 20000,
		step: 1,
		unit: 'Hz',
		category: CATEGORY.DYN2,
		access: 'rw',
	},
	{
		id: 'dyn2_highpass',
		name: 'Dyn 2 Highpass Filter',
		path: '/channel/{channel}/dyn2/highpass',
		scope: 'channel',
		kind: 'float',
		min: 20,
		max: 20000,
		step: 1,
		unit: 'Hz',
		category: CATEGORY.DYN2,
		access: 'rw',
	},

	// --- Aux sends & group assign --------------------------------------------
	{
		id: 'send_level',
		name: 'Aux Send Level',
		path: '/channel/{channel}/send/{send}/level',
		scope: 'send',
		kind: 'float',
		// Matches fader travel: the exported table stops at 0, but sends run to +10.
		min: -90,
		max: 10,
		step: 0.5,
		unit: 'dB',
		fadeable: true,
		negativeInfinityAtMin: true,
		category: CATEGORY.SENDS,
		access: 'rw',
	},
	{
		id: 'send_enabled',
		name: 'Aux Send On / Group Assign',
		path: '/channel/{channel}/send/{send}/enabled',
		scope: 'send',
		kind: 'bool',
		category: CATEGORY.SENDS,
		access: 'rw',
	},
	{
		id: 'send_pan',
		name: 'Aux Send Pan / Balance',
		path: '/channel/{channel}/send/{send}/pan',
		scope: 'send',
		kind: 'float',
		min: -1,
		max: 1,
		step: 0.01,
		fadeable: true,
		category: CATEGORY.SENDS,
		access: 'rw',
	},

	// --- Console query --------------------------------------------------------
	{
		id: 'console_ping',
		name: 'Query Console Connection (ping)',
		path: '/console/ping',
		scope: 'global',
		kind: 'trigger',
		category: CATEGORY.CONSOLE,
		access: 'w',
	},
	{
		id: 'console_resend',
		name: 'Resend All Properties',
		path: '/console/resend',
		scope: 'global',
		kind: 'trigger',
		category: CATEGORY.CONSOLE,
		access: 'rw',
	},
]

export const PARAMETERS_BY_ID = new Map(PARAMETERS.map((p) => [p.id, p]))

/** Addresses the console originates that are handled by the transport, not the state cache. */
export const ADDRESS = {
	PING: '/console/ping',
	PONG: '/console/pong',
	RESEND: '/console/resend',
	CHANNEL_COUNTS: '/console/channel/counts',
}

/** Fill `{channel}` / `{band}` / `{send}` in a path template. */
export function resolvePath(template, vars = {}) {
	return template.replace(/\{(\w+)\}/g, (match, key) => (vars[key] === undefined ? match : String(vars[key])))
}

/** Parameters that get a Companion variable generated per channel. */
export const VARIABLE_PARAMETERS = ['channel_name', 'fader', 'mute', 'solo']
