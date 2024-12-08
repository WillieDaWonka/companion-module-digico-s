const { InstanceBase, Regex, runEntrypoint } = require('@companion-module/base')
const UpgradeScripts = require('./upgrades');
const { resolveHostname, isValidIPAddress, parseArguments, evaluateComparison, setupOSC } = require('./helpers.js');
const variables = require ('./variables');

class OSCInstance extends InstanceBase {
	constructor(internal) {
		super(internal)
		this.variables = {}
	}

	//Initialization
	async init(config) {
		this.config = config;
		this.targetHost;
		this.client;
		
		this.onDataReceived = {};

		let validate = false;

		if (this.config.host) {
			if (!isValidIPAddress(this.config.host)) {
				await resolveHostname(this, this.config.host)
				.then ((ip) => {
					this.targetHost = ip;
					validate = true;
				})
				.catch(err => {
					this.log('error', `Unable to resolve hostname for ${this.config.host}: ${err.message}`);
					this.updateStatus('bad_config');
					validate = false;
				});
			} else {
				this.targetHost = this.config.host;
				validate = true;
			}
		}

		if (this.config.listen) {
			if (this.targetHost && (this.config.targetPort || this.config.feedbackPort)) {

				setupOSC(this);
				
				if (validate) {
					this.setupListeners();
				}
				
			}
		} else {
			this.updateStatus('ok');
		}
		this.initVariables(); // init variables
		this.updateActions(); // export actions
		this.updateFeedbacks(); // export feedback
		
	}
	initVariables() {
		this.setVariableDefinitions (variables.getVariableDefinitions())
		this.updateVariables({
			status: "init1",
			volume: "init 2",
			mute: "init 3"
		})
	}
	updateVariables(data) {
		for(const [key, value] of Object.entries(data)) {
		this.variables[key] = value;
		}
		if (this.setVariableValues) {
			this.setVariableValues(this.variables)
		}
	}
	// When module gets deleted
	async destroy() {
		this.log('debug', 'destroy')
	}
	  
	async configUpdated(config) {
		this.config = config;

		if (this.client && this.client.isConnected()) {
			await this.client.closeConnection()
			.then (() => {
				this.client = null;
			})
			.catch(err => {
				this.log('error', `${this.config.protocol} close error: ${err.message}`);
			});

		}

		let validate = false;
		
		if (!isValidIPAddress(this.config.host)) {
			await resolveHostname(this, this.config.host)
			.then ((ip) => {
				this.targetHost = ip;
				validate = true;
			})
			.catch(err => {
				this.log('error', `Unable to resolve hostname for ${this.config.host}: ${err.message}`);
				this.updateStatus('bad_config');
				validate = false;
			});
		} else {
			this.targetHost = this.config.host;
			validate = true;
		}

		if (!validate) {
			return;
		}

		setupOSC(this);

		this.setupListeners();
	}

	async setupListeners() {
		this.log('info', `Resetting Listeners..`);

		if (this.config.listen) {
			if (this.config.protocol && this.client && !this.client.isConnected()) {
				await this.client.openConnection()
				.catch(err => {
					this.log('error', err.message);
				});

			}
		} else {
			this.updateStatus('ok');
		}
	}
	// Return config fields for web config
	getConfigFields() {
		return [
			{
				type: 'textinput',
				id: 'host',
				label: 'Target Hostname or IP',
				width: 8
			},
			{
				type: 'textinput',
				id: 'targetPort',
				label: 'Target Port',
				width: 4,
				regex: Regex.PORT
			},
			{
				type: 'dropdown',
				id: 'protocol',
				label: 'Protocol',
				choices: [
					{ id: 'udp', label: 'UDP (Default)' },
					{ id: 'tcp', label: 'TCP' },
					{ id: 'tcp-raw', label: 'TCP (Raw)' }
				],
				default: 'udp',
				width: 4
			},
			{
				type: 'checkbox',
				id: 'polling',
				label: 'Enable Feedback? If enabled, iPad connection must be turned off on the console.',
				width: 4,
				default: false,
			},
			{
				type: 'textinput',
				id: 'feedbackPort',
				label: 'Feedback Port',
				width: 4,
				regex: Regex.PORT,
				isVisible: (options, data) => (options.listen && options.protocol === 'udp'),
			}
		]
	}

	init_polling() {
		if (this.config.polling == true) {
			this.sendOSC("/Macros/Buttons/?")
		};
	}

	updateActions() {
		const sendOscMessage = async (path, args) => {
			this.log('debug', `Sending OSC [${this.config.protocol}] ${this.targetHost}:${this.config.targetPort} ${path}`)
			this.log('debug', `Sending Args ${JSON.stringify(args)}`)

			if (this.config.protocol === 'udp') {
				this.oscSend(this.targetHost, this.config.targetPort, path, args);

			} else {
				
				await this.client.sendCommand(path, args)
				.then(() => {
					this.log('info', `${this.config.protocol} Command sent successfully. Path: ${path}, Args: ${JSON.stringify(args)}`);
				})
				.catch(err => {
					this.log('error', `Failed to send ${this.config.protocol} command:`, err.message);
				});

			}
		}

		this.setActionDefinitions({
			send_blank: {
				name: 'Send message without arguments',
				options: [
					{
						type: 'textinput',
						label: 'OSC Path',
						id: 'path',
						default: '/osc/path',
						useVariables: true,
					},
				],
				callback: async (event) => {
					const path = await this.parseVariablesInString(event.options.path)

					sendOscMessage(path, [])
				},
			},
			send_int: {
				name: 'Send integer',
				options: [
					{
						type: 'textinput',
						label: 'OSC Path',
						id: 'path',
						default: '/osc/path',
						useVariables: true,
					},
					{
						type: 'textinput',
						label: 'Value',
						id: 'int',
						default: 1,
						regex: Regex.SIGNED_NUMBER,
						useVariables: true,
					},
				],
				callback: async (event) => {
					const path = await this.parseVariablesInString(event.options.path)
					const int = await this.parseVariablesInString(event.options.int)

					sendOscMessage(path, [
						{
							type: 'i',
							value: parseInt(int),
						},
					])
				},
			},
			send_float: {
				name: 'send float',
				options: [
					{
						type: 'textinput',
						label: 'OSC Path',
						id: 'path',
						default: '/osc/path',
						useVariables: true,
					},
					{
						type: 'number',
						label: 'Value',
						id: 'float',
						default: 250,
						min: 20,
						max: 20000,
						step: 10,
						regex: Regex.SIGNED_FLOAT,
						useVariables: true,
					},
				],
				callback: async (event) => {
					const path = await this.parseVariablesInString(event.options.path)
					const float = await this.parseVariablesInString(event.options.float)

					sendOscMessage(path, [
						{
							type: 'f',
							value: parseFloat(float),
						},
					])
				},
			},
			send_boolean: {
				name: 'Send Boolean',
				options: [
					{
						type: 'static-text',
						label: 'Attention',
						value: 'The boolean type is non-standard and may only work with some receivers.',
						id: 'warning'
					},
					{
						type: 'textinput',
						label: 'OSC Path',
						id: 'path',
						default: '/osc/path',
						useVariables: true,
					},
					{
						type: 'checkbox',
						label: 'Value',
						id: 'value',
						default: false,
					},
				],
				callback: async (event) => {
					const path = await this.parseVariablesInString(event.options.path)
					let type = 'F'
					if (event.options.value === true) {
						type = 'T'
					}

					sendOscMessage(path, [
						{
							type,
						},
					])
				},
			},
			send_blob: {
				name: 'Send blob',
				options: [
					{
						type: 'static-text',
						label: 'Attention',
						value: 'The blob type is non-standard and may only work with some receivers.',
						id: 'warning'
					},
					{
						type: 'textinput',
						label: 'OSC Path',
						id: 'path',
						default: '/osc/path',
						useVariables: true,
					},
					{
						type: 'textinput',
						label: 'Blob Data (Base64)',
						id: 'blob',
						default: '',
						useVariables: true,
						isVisible: (options, data) => (options.hexswitch === false),
					},
					{
						type: 'textinput',
						label: 'Blob Data (Hex)',
						id: 'blob_hex',
						default: '',
						useVariables: true,
						isVisible: (options, data) => (options.hexswitch === true),
					},
					{
						type: 'checkbox',
						label: 'Use Hex',
						id: 'hexswitch',
						default: false,
					},

				],
				callback: async (event) => {
					const path = await this.parseVariablesInString(event.options.path);
					const blob = await this.parseVariablesInString(event.options.blob);
					
					let blobBuffer;
					
					if (event.options.hexswitch === true) {
						// Convert Hex string to a Buffer
						blobBuffer = Buffer.from(blob, 'hex');

					} else {
						// Convert Base64 string to a Buffer
						blobBuffer = Buffer.from(blob, 'base64');

					}
	
					if (!blobBuffer) {
						this.log('error', `Invalid blob data: ${blob}`);
						return;
					}
					
					sendOscMessage(path, [
						{
							type: 'b',  // OSC blob type
							value: blobBuffer,
						},
					]);
				},
			},
			test_eq: {
				name: 'test eq',
				options: [
					{
						id:"channel",
						type: 'number',
						label: 'Refer channel number according to the OSC page of your console',
						default: 120,
						min: 1,
						max: 120,
						useVariables: true,
					},
					{
						id:"band",
						type: 'number',
						label: 'Band number 1-4',
						default: 1,
						min: 1,
						max: 4,
						useVariables: true,
					},
					{
						type: 'checkbox',
						label: 'Edit Freq?',
						id: 'freqShow',
						default: false,
						useVariables: true,
					},
					{
						type: 'number',
						label: 'Frequency 20 - 20000',
						id: 'frequency',
						default: 250,
						min: 20,
						max: 20000,
						step: 10,
						regex: Regex.SIGNED_FLOAT,
						useVariables: true,
						isVisible: (options)=>options.freqShow === true,
					},
					{
						type: 'checkbox',
						label: 'Edit EQ Gain?',
						id: 'gainShow',
						default: false,
						useVariables: true,
					},
					{
						type: 'number',
						label: 'gain -18 - 18',
						id: 'gain',
						default: 0,
						min: -18,
						max: 18,
						regex: Regex.SIGNED_FLOAT,
						useVariables: true,
						isVisible: (options)=>options.gainShow === true,
					},
					{
						type: 'checkbox',
						label: 'Edit Freq Q?',
						id: 'qShow',
						default: false,
						useVariables: true,
					},
					{
						type: 'number',
						label: 'Q 0.1 - 20',
						id: 'q',
						default: 0.1,
						min: 0.1,
						max: 20,
						regex: Regex.SIGNED_FLOAT,
						useVariables: true,
						isVisible: (options)=>options.qShow === true,
					},
					{
						type: 'checkbox',
						label: 'Edit Dyn EQ Threshold?',
						id: 'dynThresholdShow',
						default: false,
						useVariables: true,
					},
					{
						type: 'number',
						label: 'Dyn EQ Threshold -60 - 0',
						id: 'threshold',
						default: 0,
						min: -60,
						max: 0,
						regex: Regex.SIGNED_FLOAT,
						useVariables: true,
						isVisible: (options)=>options.dynThresholdShow === true,
					},
					{
						type: 'checkbox',
						label: 'Edit Dyn EQ Ratio?',
						id: 'dynRatioShow',
						default: false,
						useVariables: true,
					},
					{
						type: 'number',
						label: 'Dyn EQ Ratio 1 - 10',
						id: 'ratio',
						default: 1,
						min: 1,
						max: 10,
						regex: Regex.SIGNED_FLOAT,
						useVariables: true,
						isVisible: (options)=>options.dynRatioShow === true,
					},
					{
						type: 'checkbox',
						label: 'Edit Dyn EQ Attack?',
						id: 'dynAttackShow',
						default: false,
						useVariables: true,
					},
					{
						type: 'number',
						label: 'Dyn EQ Attack 0.5 - 100 (ms)',
						id: 'attack',
						default: 0.5,
						min: 0.5,
						max: 100,
						regex: Regex.SIGNED_FLOAT,
						useVariables: true,
						isVisible: (options)=>options.dynAttackShow === true,
					},
					{
						type: 'checkbox',
						label: 'Edit Dyn EQ Release?',
						id: 'dynReleaseShow',
						default: false,
						useVariables: true,
					},
					{
						type: 'number',
						label: 'Dyn EQ Release 0.01 - 10',
						id: 'release',
						default: 0.01,
						min: 0.01,
						max: 10,
						regex: Regex.SIGNED_FLOAT,
						useVariables: true,
						isVisible: (options)=>options.dynReleaseShow === true,
					},
					{
						type: 'checkbox',
						label: 'Enable/Disable Dyn EQ?',
						id: 'dynEnabledShow',
						default: false,
						useVariables: true,
					},
					{
						type: 'dropdown',
						label: 'Dyn EQ enable/disable',
						choices: [
							{ id: 'true', label: 'Enabled' },
							{ id: 'false', label: 'Disabled' },
						],
						id: 'enabled',
						default: 'false',
						useVariables: true,
						isVisible: (options)=>options.dynEnabledShow === true,
					},
				],
				callback: async (event) => {
					if (event.options.freqShow === true) {
						const freq_path = '/channel/'+ event.options.channel + '/eq/' + event.options.band + '/frequency'
						const freq = await this.parseVariablesInString(event.options.frequency)
						
						sendOscMessage(freq_path, [
							{
								type: 'f',
								value: parseFloat(freq),
							},
						])
					}
					if (event.options.gainShow === true) {
						const gain_path = '/channel/'+ event.options.channel + '/eq/' + event.options.band + '/gain'
						const gain = await this.parseVariablesInString(event.options.gain)
						sendOscMessage(gain_path, [
							{
								type: 'f',
								value: parseFloat(gain),
							},
						])
					}
					if (event.options.qShow === true) {
						const q_path = '/channel/'+ event.options.channel + '/eq/' + event.options.band + '/q'
						const q = await this.parseVariablesInString(event.options.q)

						sendOscMessage(q_path, [
							{
								type: 'f',
								value: parseFloat(q),
							},
						])
					}
					if (event.options.dynThresholdShow === true) {
						const threshold_path = '/channel/'+ event.options.channel + '/eq/' + event.options.band + '/dyn/threshold'
						const threshold = await this.parseVariablesInString(event.options.threshold)

						sendOscMessage(threshold_path, [
							{
								type: 'f',
								value: parseFloat(threshold),
							},
						])
					}
					if (event.options.dynRatioShow === true) {
						const ratio_path = '/channel/'+ event.options.channel + '/eq/' + event.options.band + '/dyn/ratio'
						const ratio = await this.parseVariablesInString(event.options.ratio)

						sendOscMessage(ratio_path, [
							{
								type: 'f',
								value: parseFloat(ratio),
							},
						])
					}
					if (event.options.dynAttackShow === true) {
						const attack_path = '/channel/'+ event.options.channel + '/eq/' + event.options.band + '/dyn/attack'
						const attack = await this.parseVariablesInString(event.options.attack / 1000)

						sendOscMessage(attack_path, [
							{
								type: 'f',
								value: parseFloat(attack),
							},
						])
					}
					if (event.options.dynReleaseShow === true) {
						const release_path = '/channel/'+ event.options.channel + '/eq/' + event.options.band + '/dyn/release'
						const release = await this.parseVariablesInString(event.options.release)

						sendOscMessage(release_path, [
							{
								type: 'f',
								value: parseFloat(release),
							},
						])
					}
					if (event.options.dynEnabledShow === true) {
					const enabled_path = '/channel/'+ event.options.channel + '/eq/' + event.options.band + '/dyn/enabled'
					const enabled = await this.parseVariablesInString(event.options.enabled)

					sendOscMessage(enabled_path, [
						{
							type: 's',
							value: '' + enabled,
						},
					])
					}
				},
			},
			mute_enable: {
				name: 'Channel Mute',
				options: [
					{
						id:"channel",
						type: 'number',
						label: 'Refer channel number according to the OSC page of your console',
						default: 0,
						min: 0,
						max: 60,
						useVariables: true,
					},
					{
						type: 'dropdown',
						label: 'Mute/Unmute',
						choices: [
							{ id: 'true', label: 'Mute' },
							{ id: 'false', label: 'Unmute' },
						],
						id: 'string',
						default: 'true',
						useVariables: true,
					},
				],
				callback: async (event) => {
					const path = '/channel/'+ event.options.channel + '/mute'
					//await this.parseVariablesInString(event.options.path)
					const string = await this.parseVariablesInString(event.options.string)

					sendOscMessage(path, [
						{
							type: 's',
							value: '' + string,
						},
					])
				},
			},
			delay_enable: {
				name: 'Channel Mute',
				options: [
					{
						id:"channel",
						type: 'number',
						label: 'Refer channel number according to the OSC page of your console',
						default: 0,
						min: 0,
						max: 60,
						useVariables: true,
					},
					{
						type: 'dropdown',
						label: 'Mute/Unmute',
						choices: [
							{ id: 'true', label: 'Mute' },
							{ id: 'false', label: 'Unmute' },
						],
						id: 'string',
						default: 'true',
						useVariables: true,
					},
				],
				callback: async (event) => {
					const path = '/channel/'+ event.options.channel + '/mute'
					//await this.parseVariablesInString(event.options.path)
					const string = await this.parseVariablesInString(event.options.string)

					sendOscMessage(path, [
						{
							type: 's',
							value: '' + string,
						},
					])
				},
			},
			mute_enable: {
				name: 'Channel Mute',
				options: [
					{
						id:"channel",
						type: 'number',
						label: 'Refer channel number according to the OSC page of your console',
						default: 0,
						min: 0,
						max: 60,
						useVariables: true,
					},
					{
						type: 'dropdown',
						label: 'Mute/Unmute',
						choices: [
							{ id: 'true', label: 'Mute' },
							{ id: 'false', label: 'Unmute' },
						],
						id: 'string',
						default: 'true',
						useVariables: true,
					},
				],
				callback: async (event) => {
					const path = '/channel/'+ event.options.channel + '/mute'
					//await this.parseVariablesInString(event.options.path)
					const string = await this.parseVariablesInString(event.options.string)

					sendOscMessage(path, [
						{
							type: 's',
							value: '' + string,
						},
					])
				},
			},
			mute_enable: {
				name: 'Channel Mute',
				options: [
					{
						id:"channel",
						type: 'number',
						label: 'Refer channel number according to the OSC page of your console',
						default: 0,
						min: 0,
						max: 60,
						useVariables: true,
					},
					{
						type: 'dropdown',
						label: 'Mute/Unmute',
						choices: [
							{ id: 'true', label: 'Mute' },
							{ id: 'false', label: 'Unmute' },
						],
						id: 'string',
						default: 'true',
						useVariables: true,
					},
				],
				callback: async (event) => {
					const path = '/channel/'+ event.options.channel + '/mute'
					//await this.parseVariablesInString(event.options.path)
					const string = await this.parseVariablesInString(event.options.string)

					sendOscMessage(path, [
						{
							type: 's',
							value: '' + string,
						},
					])
				},
			},
			mute_enable: {
				name: 'Channel Mute',
				options: [
					{
						id:"channel",
						type: 'number',
						label: 'Refer channel number according to the OSC page of your console',
						default: 0,
						min: 0,
						max: 60,
						useVariables: true,
					},
					{
						type: 'dropdown',
						label: 'Mute/Unmute',
						choices: [
							{ id: 'true', label: 'Mute' },
							{ id: 'false', label: 'Unmute' },
						],
						id: 'string',
						default: 'true',
						useVariables: true,
					},
				],
				callback: async (event) => {
					const path = '/channel/'+ event.options.channel + '/mute'
					//await this.parseVariablesInString(event.options.path)
					const string = await this.parseVariablesInString(event.options.string)

					sendOscMessage(path, [
						{
							type: 's',
							value: '' + string,
						},
					])
				},
			},
			send_multiple: {
				name: 'Send message with multiple arguments',
				options: [
					{
						type: 'textinput',
						label: 'OSC Path',
						id: 'path',
						default: '/osc/path',
						useVariables: true,
					},
					{
						type: 'textinput',
						label: 'Arguments',
						id: 'arguments',
						default: '1 "test" 2.5',
						useVariables: true,
					},
				],
				callback: async (event) => {
					const path = await this.parseVariablesInString(event.options.path)
					const argsStr = await this.parseVariablesInString(event.options.arguments)

					const rawArgs = (argsStr + '').replace(/“/g, '"').replace(/”/g, '"').split(' ')

					if (rawArgs.length) {
						const args = []
						for (let i = 0; i < rawArgs.length; i++) {
							if (rawArgs[i].length == 0) continue
							if (isNaN(rawArgs[i])) {
								let str = rawArgs[i]
								if (str.startsWith('"')) {
									//a quoted string..
									while (!rawArgs[i].endsWith('"')) {
										i++
										str += ' ' + rawArgs[i]
									}
								} else if(str.startsWith('{')) {
									//Probably a JSON object
									try {
										args.push((JSON.parse(rawArgs[i])))
									} catch (error) {
										this.log('error', `not a JSON object ${rawArgs[i]}`)
									}
								}

								args.push({
									type: 's',
									value: str.replace(/"/g, '').replace(/'/g, ''),
								})
							} else if (rawArgs[i].indexOf('.') > -1) {
								args.push({
									type: 'f',
									value: parseFloat(rawArgs[i]),
								})
							} else {
								args.push({
									type: 'i',
									value: parseInt(rawArgs[i]),
								})
							}
						}

						sendOscMessage(path, args)
					}
				},
			},
		})
	}
	
	updateFeedbacks() {
		this.setFeedbackDefinitions({
			osc_feedback_int: {
				type: 'boolean',
				name: 'Listen for OSC messages (Integer)',
				description: 'Listen for OSC messages. Requires "Listen for Feedback" option to be enabled in OSC config.',
				options: [
					{
						type: 'textinput',
						label: 'OSC Path',
						id: 'path',
						default: '/osc/path',
						useVariables: true,
					},
					{
						type: 'textinput',
						label: 'Value',
						id: 'arguments',
						default: 1,
						regex: Regex.SIGNED_NUMBER,
						useVariables: true,
					},
					{
						id: 'comparison',
						type: 'dropdown',
						label: 'Comparison',
						choices: [
							{ id: 'equal', label: '=' },
							{ id: 'greaterthan', label: '>' },
							{ id: 'lessthan', label: '<' },
							{ id: 'greaterthanequal', label: '>=' },
							{ id: 'lessthanequal', label: '<=' },
							{ id: 'notequal', label: '!=' },
						],
						default: 'equal'
					}
				],
				callback: async (feedback, context) => {
					const path = await context.parseVariablesInString(feedback.options.path || '');
					const targetValueStr = await context.parseVariablesInString(feedback.options.arguments || '');
					const comparison = feedback.options.comparison;
			
					this.log('debug', `Evaluating feedback ${feedback.id}.`);
			
					const targetValue = parseFloat(targetValueStr);
					if (isNaN(targetValue)) {
						this.log('warn', `Invalid target value: ${targetValueStr}`);
						return false;
					}
			
					if (this.onDataReceived.hasOwnProperty(path)) {
						const rx_args = this.onDataReceived[path];
						const receivedValue = parseFloat(rx_args[0]);
			
						const comparisonResult = evaluateComparison(receivedValue, targetValue, comparison);
			
						this.log('debug', `Feedback ${feedback.id} comparison result: ${comparisonResult}`);
						return comparisonResult;
					} else {
						this.log('debug', `Feedback ${feedback.id} returned false! Path does not exist yet in dictionary.`);
						return false;
					}
				}
			},
			osc_feedback_float: {
				type: 'boolean',
				name: 'Listen for OSC messages (Float)',
				description: 'Listen for OSC messages. Requires "Listen for Feedback" option to be enabled in OSC config.',
				options: [
					{
						type: 'textinput',
						label: 'OSC Path',
						id: 'path',
						default: '/osc/path',
						useVariables: true,
					},
					{
						type: 'textinput',
						label: 'Value',
						id: 'arguments',
						default: 1,
						regex: Regex.SIGNED_FLOAT,
						useVariables: true,
					},
					{
						id: 'comparison',
						type: 'dropdown',
						label: 'Comparison',
						choices: [
							{ id: 'equal', label: '=' },
							{ id: 'greaterthan', label: '>' },
							{ id: 'lessthan', label: '<' },
							{ id: 'greaterthanequal', label: '>=' },
							{ id: 'lessthanequal', label: '<=' },
							{ id: 'notequal', label: '!=' },
						],
						default: 'equal'
					}
				],
				callback: async (feedback, context) => {
					const path = await context.parseVariablesInString(feedback.options.path || '');
					const targetValueStr = await context.parseVariablesInString(feedback.options.arguments || '');
					const comparison = feedback.options.comparison;
			
					this.log('debug', `Evaluating feedback ${feedback.id}.`);
			
					const targetValue = parseFloat(targetValueStr);
					if (isNaN(targetValue)) {
						this.log('warn', `Invalid target value: ${targetValueStr}`);
						return false;
					}
			
					if (this.onDataReceived.hasOwnProperty(path)) {
						const rx_args = this.onDataReceived[path];
						const receivedValue = parseFloat(rx_args[0]);
			
						const comparisonResult = evaluateComparison(receivedValue, targetValue, comparison);
			
						this.log('debug', `Feedback ${feedback.id} comparison result: ${comparisonResult}`);
						return comparisonResult;
					} else {
						this.log('debug', `Feedback ${feedback.id} returned false! Path does not exist yet in dictionary.`);
						return false;
					}
				}
			},
			osc_feedback_bool: {
				type: 'boolean',
				name: 'Listen for OSC messages (Boolean)',
				description: 'Listen for OSC messages. Requires "Listen for Feedback" option to be enabled in OSC config.',
				options: [
					{
						type: 'static-text',
						label: 'Attention',
						value: 'The boolean type is non-standard and may only work with some receivers.',
						id: 'warning'
					},
					{
						type: 'textinput',
						label: 'OSC Path',
						id: 'path',
						default: '/osc/path',
						useVariables: true,
					},
					{
						type: 'checkbox',
						label: 'Value',
						id: 'arguments',
						default: false,
					},
					{
						id: 'comparison',
						type: 'dropdown',
						label: 'Comparison',
						choices: [
							{ id: 'equal', label: '=' },
							{ id: 'notequal', label: '!=' },
						],
						default: 'equal'
					}
				],
				callback: async (feedback, context) => {
					const path = await context.parseVariablesInString(feedback.options.path || '');
					const targetValue = feedback.options.arguments;
					const comparison = feedback.options.comparison;
			
					this.log('debug', `Evaluating feedback ${feedback.id}.`);
			
					if (this.onDataReceived.hasOwnProperty(path)) {
						const rx_args = this.onDataReceived[path];
						const receivedValue = rx_args[0] === true ? true : false;
			
						const comparisonResult = evaluateComparison(receivedValue, targetValue, comparison);
			
						this.log('debug', `Feedback ${feedback.id} comparison result: ${comparisonResult}`);
						return comparisonResult;
					} else {
						this.log('debug', `Feedback ${feedback.id} returned false! Path does not exist yet in dictionary.`);
						return false;
					}
				}
			},
			osc_feedback_multi: {
				type: 'boolean',
				name: 'Listen for OSC messages (Multiple Arguments)',
				description: 'Listen for OSC messages. Requires "Listen for Feedback" option to be enabled in OSC config.',
				options: [
					{
						type: 'textinput',
						label: 'OSC Path',
						id: 'path',
						default: '/osc/path',
						useVariables: true,
					},
					{
						type: 'textinput',
						label: 'Arguments',
						id: 'arguments',
						default: '1 "test" 2.5',
						useVariables: true,
					},
					{
						id: 'comparison',
						type: 'dropdown',
						label: 'Comparison',
						choices: [
							{ id: 'equal', label: '=' },
							{ id: 'notequal', label: '!=' },
						],
						default: 'equal'
					}
				],
				callback: async (feedback, context) => {
					const path = await context.parseVariablesInString(feedback.options.path || '');
					let argsStr = await context.parseVariablesInString(feedback.options.arguments || '');
					const comparison = feedback.options.comparison;
			
					this.log('debug', `Evaluating feedback ${feedback.id}.`);
			
					const { args, error } = parseArguments(argsStr);
					if (error) {
						this.log('warn', error);
						return false;
					}
			
					if (this.onDataReceived.hasOwnProperty(path)) {
						const rx_args = this.onDataReceived[path];
						let comparisonResult = (comparison === 'equal');
						for (let i = 0; i < args.length; i++) {
							comparisonResult = evaluateComparison(rx_args[i], args[i], comparison);
							if ((comparison === 'equal' && !comparisonResult) || (comparison === 'notequal' && comparisonResult)) {
								break;
							}
						}
			
						this.log('debug', `Feedback ${feedback.id} comparison result: ${comparisonResult}`);
						return comparisonResult;
					} else {
						this.log('debug', `Feedback ${feedback.id} returned false! Path does not exist yet in dictionary.`);
						return false;
					}
				}
			},			
			osc_feedback_noargs: {
				type: 'boolean',
				name: 'Listen for OSC messages (No Arguments)',
				description: 'Listen for OSC messages. Requires "Listen for Feedback" option to be enabled in OSC config.',
				options: [
					{
						type: 'textinput',
						label: 'OSC Path',
						id: 'path',
						default: '/osc/path',
						useVariables: true,
					}
				],
				callback: async (feedback, context) => {
					const path = await context.parseVariablesInString(feedback.options.path || '');
					this.log('debug', `Evaluating feedback ${feedback.id}.`);
	
					if (this.onDataReceived.hasOwnProperty(path) && this.onDataReceived[path].length > 0) {
						this.log('debug', `Feedback ${feedback.id} returned true!`);
						delete this.onDataReceived[path]; // Remove the path from the dictionary to create a debounce
						return true;
					} else {
						this.log('debug', `Feedback ${feedback.id} returned false! Path does not exist yet in dictionary.`);
						return false;
					}
				}
				
			}
		});
	}	
	
	
}

runEntrypoint(OSCInstance, UpgradeScripts);