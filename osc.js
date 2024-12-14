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
		// Need to add "/console/ping" with no arg and await reply of "/console/pong" with no args -WL
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
		//this.initVariables(); // init variables // commented out for dynamic variables
		this.updateActions(); // export actions
		this.updateFeedbacks(); // export feedback

	}
	initVariables() {
		this.setVariableDefinitions (variables.getVariableDefinitions())
	}
	updateVariables(data) {
		for(const [key, value] of Object.entries(data)) {
			this.variables[key] = value;
		}
		if (this.setVariableValues) {
			this.setVariableValues(this.variables)
		}
	}

	handleIncomingData(channel, path, value) {
		variables.updateVariables(this, channel, path, value);
	}

	handleIncomingChannelData(channel, data) {
		variables.updateMultipleVariables(this, channel, data);
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
				//Rewording
				label: 'Enable Feedback? This may cause network errors between Companion and console',
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
	// In theory, this pulls all data from console, but should only be used if 'option.polling === true' -WL
	init_polling() {
		if (this.config.polling == true) {
			this.sendOSC("/console/resend")
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

		const sendOscEQMessagesForBands = async (channel, bands, type, value, variableType = 'f') => {
			const parsedValue = await this.parseVariablesInString(value);
			const mutiPaths = {};
			for (let band of bands) {
				const oscPath = `/channel/${channel}/eq/${band}/${type}`;
				sendOscMessage(oscPath, [
					{
						type: variableType,
						value: variableType === 'f' ? parseFloat(parsedValue) : '' + parsedValue,
					},
				]);
				const varPath = `eq/${band}/${type}`;
				mutiPaths[varPath] = parsedValue;
				variables.getOrDefineVariable(this, channel, varPath);
			}
			this.handleIncomingChannelData(channel, mutiPaths);
		}

		const sendOscDynMessages = async (channel, dyn, type, value, variableType = 'f') => {
			const parsedValue = await this.parseVariablesInString(value);
			const oscPath = `/channel/${channel}/dyn${dyn}/${type}`;
			sendOscMessage(oscPath, [
				{
					type: variableType,
					value: variableType === 'f' ? parseFloat(parsedValue) : '' + parsedValue,
				},
			]);
			const varPath = `dyn${dyn}/${type}`;
			variables.getOrDefineVariable(this, channel, varPath);
			
			this.handleIncomingData(channel, varPath, parsedValue);
		}

		const sendOscDynMessagesForBands = async (channel, bands, dyn, type, value, variableType = 'f') => {
			const parsedValue = await this.parseVariablesInString(value);
			const mutiPaths = {};
			for (let band of bands) {
				const oscPath = `/channel/${channel}/dyn${dyn}/${band}/${type}`;
				sendOscMessage(oscPath, [
					{
						type: variableType,
						value: variableType === 'f' ? parseFloat(parsedValue) : '' + parsedValue,
					},
				]);
				const varPath = `dyn${dyn}/${band}/${type}`;
				mutiPaths[varPath] = parsedValue;
				variables.getOrDefineVariable(this, channel, varPath);
			}
			this.handleIncomingChannelData(channel, mutiPaths);
		}

		this.setActionDefinitions({
			inputEQ: {
				name: 'Input Channel EQ',
				options: [
					{
						id:"channel",
						type: 'number',
						label: 'Refer channel number according to the OSC page of your console',
						min: 1,
						max: 94,
						default: 1,
						useVariables: true,
						tooltip: 'Inputs: 1-60 | Aux/Groups: 70-94 | Master: 120',
					},
					{
						id:"band",
						type: 'multidropdown',
						label: 'Band number 1-4',
						choices: [
							{ id: '1', label: '1' },
							{ id: '2', label: '2' },
							{ id: '3', label: '3' },
							{ id: '4', label: '4' },
						],
						maxSelection: 1,
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
						label: 'Frequency',
						id: 'frequency',
						default: 250,
						min: 20,
						max: 20000,
						step: 10,
						regex: Regex.SIGNED_FLOAT,
						useVariables: true,
						isVisible: (options)=>options.freqShow === true,
						tooltip: '20 - 20000Hz',
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
						label: 'EQ Gain',
						id: 'gain',
						default: 0,
						min: -18,
						max: 18,
						regex: Regex.SIGNED_FLOAT,
						useVariables: true,
						isVisible: (options)=>options.gainShow === true,
						tooltip: '-18 -18dB',
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
						label: 'EQ Band Q',
						id: 'q',
						default: 4,
						min: 0.1,
						max: 20,
						regex: Regex.SIGNED_FLOAT,
						useVariables: true,
						isVisible: (options)=>options.qShow === true,
						tooltip: '0.1 - 20',
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
					{
						type: 'checkbox',
						label: 'Edit Dyn EQ Threshold?',
						id: 'dynThresholdShow',
						default: false,
						useVariables: true,
						isVisible: (options)=>options.dynEnabledShow === true,
					},
					{
						type: 'number',
						label: 'Dyn EQ Threshold',
						id: 'threshold',
						default: 0,
						min: -60,
						max: 0,
						regex: Regex.SIGNED_FLOAT,
						useVariables: true,
						isVisible: (options)=>options.dynThresholdShow === true && options.dynEnabledShow === true,
						tooltip: '-60 - 0',
					},
					{
						type: 'checkbox',
						label: 'Edit Dyn EQ Ratio?',
						id: 'dynRatioShow',
						default: false,
						useVariables: true,
						isVisible: (options)=>options.dynEnabledShow === true,
					},
					{
						type: 'number',
						label: 'Dyn EQ Ratio',
						id: 'ratio',
						default: 1,
						min: 1,
						max: 10,
						regex: Regex.SIGNED_FLOAT,
						useVariables: true,
						isVisible: (options)=>options.dynRatioShow === true && options.dynEnabledShow === true,
						tooltip: '1 -10',
					},
					{
						type: 'checkbox',
						label: 'Edit Dyn EQ Attack?',
						id: 'dynAttackShow',
						default: false,
						useVariables: true,
						isVisible: (options)=>options.dynEnabledShow === true,
					},
					{
						type: 'number',
						label: 'Dyn EQ Attack',
						id: 'attack',
						default: 0.5,
						min: 0.5,
						max: 100,
						regex: Regex.SIGNED_FLOAT,
						useVariables: true,
						isVisible: (options)=>options.dynAttackShow === true && options.dynEnabledShow === true,
						tooltip: '0.5 - 100ms',
					},
					{
						type: 'checkbox',
						label: 'Edit Dyn EQ Release?',
						id: 'dynReleaseShow',
						default: false,
						useVariables: true,
						isVisible: (options)=>options.dynEnabledShow === true,
					},
					{
						type: 'number',
						label: 'Dyn EQ Release',
						id: 'release',
						default: 0.01,
						min: 0.01,
						max: 10,
						regex: Regex.SIGNED_FLOAT,
						useVariables: true,
						isVisible: (options)=>options.dynReleaseShow === true && options.dynEnabledShow === true,
						tooltip: '0.01 - 10',
					},
				],
				callback: async (event) => {
					
					if (event.options.freqShow === true) {
						await sendOscEQMessagesForBands(event.options.channel, event.options.band, 'frequency', event.options.frequency);
					}					
					if (event.options.gainShow === true) {
						await sendOscEQMessagesForBands(event.options.channel, event.options.band, 'gain', event.options.gain);
					}				
					if (event.options.qShow === true) {
						await sendOscEQMessagesForBands(event.options.channel, event.options.band, 'q', event.options.q);
					}
					if (event.options.enabled === false) {
						await sendOscEQMessagesForBands(event.options.channel, event.options.band, 'enabled', 'false', 's');
					}
					if (event.options.enabled === true) {
						await sendOscEQMessagesForBands(event.options.channel, event.options.band, 'enabled', 'true', 's');
					}					
					if (event.options.dynThresholdShow === true) {
						await sendOscEQMessagesForBands(event.options.channel, event.options.band, 'dyn/threshold', event.options.threshold);
					}					
					if (event.options.dynRatioShow === true) {
						await sendOscEQMessagesForBands(event.options.channel, event.options.band, 'dyn/ratio', event.options.ratio);
					}					
					if (event.options.dynAttackShow === true) {
						await sendOscEQMessagesForBands(event.options.channel, event.options.band, 'dyn/attack', event.options.attack / 1000);
					}					
					if (event.options.dynReleaseShow === true) {
						await sendOscEQMessagesForBands(event.options.channel, event.options.band, 'dyn/release', event.options.release);
					}					
					if (event.options.dynEnabledShow === true) {
						await sendOscEQMessagesForBands(event.options.channel, event.options.band, 'dyn/enabled', event.options.enabled, 's');
					}
				},
			},
			dyn1: {
				name: 'Channel Dynamics 1',
				options: [
					{
						id:"channel",
						type: 'number',
						label: 'Refer channel number according to the OSC page of your console',
						default: 1,
						min: 1,
						max: 94,
						useVariables: true,
						tooltip: 'Inputs: 1-60 | Aux/Groups: 70-94 | Master: 120',
					},
					{
						type: 'checkbox',
						label: 'Enable/Disable Dyn1?',
						id: 'dynShow',
						default: false,
						useVariables: true,
					},
					{
						type: 'checkbox',
						label: 'Edit Dynamics Type?',
						id: 'typeShow',
						default: false,
						useVariables: true,
						isVisible: (options)=>options.dynShow === true,
					},
					{
						type: 'number',
						label: 'Dyn1 Type',
						id: 'type',
						default: 1,
						min: 1,
						max: 2,
						regex: Regex.SIGNED_NUMBER,
						useVariables: true,
						isVisible: (options)=>options.typeShow === true && options.dynShow === true,
						tooltip: '1 / 2',
					},
					{
						type: 'checkbox',
						label: 'Edit Sidechain LowPass Freq?',
						id: 'lpfreqShow',
						default: false,
						useVariables: true,
						isVisible: (options)=>options.dynShow === true,
					},
					{
						type: 'number',
						label: 'Sidechain LowPass Frequency',
						id: 'lpfrequency',
						default: 10000,
						min: 20,
						max: 20000,
						step: 10,
						regex: Regex.SIGNED_FLOAT,
						useVariables: true,
						isVisible: (options)=>options.lpfreqShow === true && options.dynShow === true,
						tooltip: '20 -20000Hz',
					},
					{
						type: 'checkbox',
						label: 'Edit Sidechain HighPassFreq?',
						id: 'hpfreqShow',
						default: false,
						useVariables: true,
						isVisible: (options)=>options.dynShow === true,
					},
					{
						type: 'number',
						label: 'Sidechain HighPass Frequency',
						id: 'hpfrequency',
						default: 120,
						min: 20,
						max: 20000,
						step: 10,
						regex: Regex.SIGNED_FLOAT,
						useVariables: true,
						isVisible: (options)=>options.hpfreqShow === true && options.dynShow === true,
						tooltip: '20 -20000Hz',
					},
					{
						id:"band",
						type: 'multidropdown',
						label: 'Band number 1-3',
						choices: [
							{ id: '1', label: '1' },
							{ id: '2', label: '2' },
							{ id: '3', label: '3' },
						],
						maxSelection: 1,
						useVariables: true,
						isVisible: (options)=>options.dynShow === true && options.type === 2,
					},
					{
						type: 'checkbox',
						label: 'Edit Band Threshold?',
						id: 'dynThresholdShow',
						default: false,
						useVariables: true,
						isVisible: (options)=>options.dynShow === true,
					},
					{
						type: 'number',
						label: 'Band Threshold Value',
						id: 'threshold',
						default: 1,
						min: 1,
						max: 50,
						regex: Regex.SIGNED_FLOAT,
						useVariables: true,
						isVisible: (options)=>options.dynThresholdShow === true && options.dynShow === true,
						tooltip: '1 - 50',
					},
					{
						type: 'checkbox',
						label: 'Edit Band Ratio?',
						id: 'dynRatioShow',
						default: false,
						useVariables: true,
						isVisible: (options)=>options.dynShow === true,
					},
					{
						type: 'number',
						label: 'Band Ratio Value',
						id: 'ratio',
						default: 1,
						min: 1,
						max: 50,
						regex: Regex.SIGNED_FLOAT,
						useVariables: true,
						isVisible: (options)=>options.dynRatioShow === true && options.dynShow === true,
						tooltip: '1 - 50',
					},
					{
						type: 'checkbox',
						label: 'Edit Band Gain?',
						id: 'gainShow',
						default: false,
						useVariables: true,
						isVisible: (options)=>options.dynShow === true,
					},
					{
						type: 'number',
						label: 'Band Gain Value',
						id: 'gain',
						default: 0,
						min: 0,
						max: 40,
						regex: Regex.SIGNED_FLOAT,
						useVariables: true,
						isVisible: (options)=>options.gainShow === true,
						tooltip: '0 - 40dB',
					},
					{
						type: 'checkbox',
						label: 'Edit Band Attack?',
						id: 'dynAttackShow',
						default: false,
						useVariables: true,
						isVisible: (options)=>options.dynShow === true,
					},
					{
						type: 'number',
						label: 'Dyn Band Attack Value',
						id: 'attack',
						default: 0.5,
						min: 0.5,
						max: 100,
						regex: Regex.SIGNED_FLOAT,
						useVariables: true,
						isVisible: (options)=>options.dynAttackShow === true && options.dynShow === true,
						tooltip: '0.5 - 100ms',
					},
					{
						type: 'checkbox',
						label: 'Edit Band Release?',
						id: 'dynReleaseShow',
						default: false,
						useVariables: true,
						isVisible: (options)=>options.dynShow === true,
					},
					{
						type: 'number',
						label: 'Dyn Release Value',
						id: 'release',
						default: 0.005,
						min: 0.005,
						max: 0.1,
						regex: Regex.SIGNED_FLOAT,
						useVariables: true,
						isVisible: (options)=>options.dynReleaseShow === true && options.dynShow === true,
						tooltip: '5 - 100ms',
					},
					{
						type: 'checkbox',
						label: 'Edit Band Knee?',
						id: 'kneeShow',
						default: false,
						useVariables: true,
						isVisible: (options)=>options.dynShow === true,
					},
					{
						type: 'dropdown',
						label: 'Dyn Knee Value',
						id: 'knee',
						choices: [
							{ id: '1', label: 'Soft' },
							{ id: '2', label: 'Medium' },
							{ id: '3', label: 'Hard' },
						],
						default: '1',
						regex: Regex.SIGNED_NUMBER,
						useVariables: true,
						isVisible: (options)=>options.kneeShow === true && options.dynShow === true,
					},
				],
				callback: async (event) => {
					if (event.options.dynShow === false) {
						await sendOscDynMessages(event.options.channel, 1, 'enabled', 'false', 's');
					}
					if (event.options.dynShow === true) {
						await sendOscDynMessages(event.options.channel, 1, 'enabled', 'true', 's');
					}
					if (event.options.typeShow === true) {
						await sendOscDynMessages(event.options.channel, 1, 'mode', event.options.type, 'i');
					}
					if (event.options.lpfreqShow === true) {
						await sendOscDynMessages(event.options.channel, 1, 'crossover_low', event.options.lpfrequency);
					}
					if (event.options.hpfreqShow === true) {
						await sendOscDynMessages(event.options.channel, 1, 'crossover_high', event.options.hpfrequency);
					}
					if (event.options.dynThresholdShow === true) {
						await sendOscDynMessagesForBands(event.options.channel, event.options.band, 1, 'dyn/threshold', event.options.threshold);
					}
					if (event.options.dynRatioShow === true) {
						await sendOscDynMessagesForBands(event.options.channel, event.options.band, 1, 'dyn/ratio', event.options.ratio);
					}
					if (event.options.gainShow === true) {
						await sendOscDynMessagesForBands(event.options.channel, event.options.band, 1, 'gain', event.options.gain);
					}
					if (event.options.dynAttackShow === true) {
						await sendOscDynMessagesForBands(event.options.channel, event.options.band, 1, 'attack', event.options.attack / 1000);
					}
					if (event.options.dynReleaseShow === true) {
						await sendOscDynMessagesForBands(event.options.channel, event.options.band, 1, 'release', event.options.release);
					}
					if (event.options.kneeShow === true) {
						await sendOscDynMessagesForBands(event.options.channel, event.options.band, 1, 'knee', event.options.knee, 'i');
					}
				},
			},
			// Channel Dynamics 2
			dyn2: {
				name: 'Channel Dynamics 2',
				options: [
					{
						id:"channel",
						type: 'number',
						label: 'Refer channel number according to the OSC page of your console',
						default: 1,
						min: 1,
						max: 94,
						useVariables: true,
						tooltip: 'Inputs: 1-60 | Aux/Groups: 70-94 | Master: 120',
					},
					{
						type: 'checkbox',
						label: 'Enable/Disable Dyn2?',
						id: 'dynShow',
						default: false,
						useVariables: true,
					},
					{
						type: 'checkbox',
						label: 'Edit Dynamics Type?',
						id: 'typeShow',
						default: false,
						useVariables: true,
						isVisible: (options)=>options.dynShow === true,
					},
					{
						type: 'number',
						label: 'Dyn2 Type',
						id: 'type',
						default: 1,
						min: 1,
						max: 2,
						regex: Regex.SIGNED_NUMBER,
						useVariables: true,
						isVisible: (options)=>options.typeShow === true && options.dynShow === true,
						tooltip: '1 / 2',
					},
					{
						type: 'checkbox',
						label: 'Edit Gain?',
						id: 'gainShow',
						default: false,
						useVariables: true,
						isVisible: (options)=>options.dynShow === true,
					},
					{
						type: 'number',
						label: 'Gain Value',
						id: 'gain',
						default: 0,
						min: 0,
						max: 40,
						regex: Regex.SIGNED_FLOAT,
						useVariables: true,
						isVisible: (options)=>options.gainShow === true && options.dynShow === true,
						tooltip: '0 - 40dB',
					},
					{
						type: 'checkbox',
						label: 'Edit Threshold?',
						id: 'dynThresholdShow',
						default: false,
						useVariables: true,
						isVisible: (options)=>options.dynShow === true,
					},
					{
						type: 'number',
						label: 'Threshold Value',
						id: 'threshold',
						default: 1,
						min: 1,
						max: 50,
						regex: Regex.SIGNED_FLOAT,
						useVariables: true,
						isVisible: (options)=>options.dynThresholdShow === true && options.dynShow === true,
						tooltip: '1 - 50',
					},
					{
						type: 'checkbox',
						label: 'Edit Range?',
						id: 'dynRangeShow',
						default: false,
						useVariables: true,
						isVisible: (options)=>options.dynShow === true,
					},
					{
						type: 'number',
						label: 'Range Value',
						id: 'range',
						default: 0,
						min: -90,
						max: 0,
						regex: Regex.SIGNED_FLOAT,
						useVariables: true,
						isVisible: (options)=>options.dynRangeShow === true && options.dynShow === true,
						tooltip: '-90 - 0',
					},
					{
						type: 'checkbox',
						label: 'Edit Ratio?',
						id: 'dynRatioShow',
						default: false,
						useVariables: true,
						isVisible: (options)=>options.dynShow === true,
					},
					{
						type: 'number',
						label: 'Ratio Value',
						id: 'ratio',
						default: 1,
						min: 1,
						max: 50,
						regex: Regex.SIGNED_FLOAT,
						useVariables: true,
						isVisible: (options)=>options.dynRatioShow === true && options.dynShow === true,
						tooltip: '1 - 50',
					},
					{
						type: 'checkbox',
						label: 'Edit Attack?',
						id: 'dynAttackShow',
						default: false,
						useVariables: true,
						isVisible: (options)=>options.dynShow === true,
					},
					{
						type: 'number',
						label: 'Dyn Attack Value',
						id: 'attack',
						default: 5,
						min: 5,
						max: 100,
						regex: Regex.SIGNED_FLOAT,
						useVariables: true,
						isVisible: (options)=>options.dynAttackShow === true && options.dynShow === true,
						tooltip: '5 - 100ms',
					},
					{
						type: 'checkbox',
						label: 'Edit Hold?',
						id: 'dynHoldShow',
						default: false,
						useVariables: true,
						isVisible: (options)=>options.dynShow === true,
					},
					{
						type: 'number',
						label: 'Dyn Hold Value',
						id: 'hold',
						default: 500,
						min: 2,
						max: 2000,
						regex: Regex.SIGNED_FLOAT,
						useVariables: true,
						isVisible: (options)=>options.dynHoldShow === true && options.dynShow === true,
						tooltip: '2 - 2000ms',
					},
					{
						type: 'checkbox',
						label: 'Edit Release?',
						id: 'dynReleaseShow',
						default: false,
						useVariables: true,
						isVisible: (options)=>options.dynShow === true,
					},
					{
						type: 'number',
						label: 'Dyn Release Value',
						id: 'release',
						default: 5,
						min: 5,
						max: 100,
						regex: Regex.SIGNED_FLOAT,
						useVariables: true,
						isVisible: (options)=>options.dynReleaseShow === true && options.dynShow === true,
						tooltip: '5 - 100ms',
					},
					{
						type: 'checkbox',
						label: 'Edit Knee?',
						id: 'kneeShow',
						default: false,
						useVariables: true,
						isVisible: (options)=>options.dynShow === true,
					},
					{
						type: 'dropdown',
						label: 'Dyn Knee Value',
						id: 'knee',
						default: 1,
						choices: [
							{ id: '1', label: 'Soft' },
							{ id: '2', label: 'Medium' },
							{ id: '3', label: 'Hard' },
						],
						regex: Regex.SIGNED_NUMBER,
						useVariables: true,
						isVisible: (options)=>options.kneeShow === true && options.dynShow === true,
					},
					{
						type: 'checkbox',
						label: 'Edit Sidechain LowPass Freq?',
						id: 'lpfreqShow',
						default: false,
						useVariables: true,
						isVisible: (options)=>options.dynShow === true,
					},
					{
						type: 'number',
						label: 'Sidechain LowPass Frequency',
						id: 'lpfrequency',
						default: 10000,
						min: 20,
						max: 20000,
						step: 10,
						regex: Regex.SIGNED_FLOAT,
						useVariables: true,
						isVisible: (options)=>options.lpfreqShow === true && options.dynShow === true,
						tooltip: '20 - 20000Hz',
					},
					{
						type: 'checkbox',
						label: 'Edit Sidechain HighPassFreq?',
						id: 'hpfreqShow',
						default: false,
						useVariables: true,
						isVisible: (options)=>options.dynShow === true,
					},
					{
						type: 'number',
						label: 'Sidechain HighPass Frequency',
						id: 'hpfrequency',
						default: 120,
						min: 20,
						max: 20000,
						step: 10,
						regex: Regex.SIGNED_FLOAT,
						useVariables: true,
						isVisible: (options)=>options.hpfreqShow === true && options.dynShow === true,
						tooltip: '20 - 20000Hz',
					},
				],
				callback: async (event) => {
					if (event.options.dynShow === false) {
						await sendOscDynMessages(event.options.channel, 2, 'enabled', 'false', 's');
					}
					if (event.options.dynShow === true) {
						await sendOscDynMessages(event.options.channel, 2, 'enabled', 'true', 's');
					}
					if (event.options.typeShow === true) {
						await sendOscDynMessages(event.options.channel, 2, 'mode', event.options.type, 'i');
					}
					if (event.options.gainShow === true) {
						await sendOscDynMessages(event.options.channel, 2, 'gain', event.options.gain);
					}
					if (event.options.dynThresholdShow === true) {
						await sendOscDynMessages(event.options.channel, 2, 'threshold', event.options.threshold);
					}
					if (event.options.dynRangeShow === true) {
						await sendOscDynMessages(event.options.channel, 2, 'range', event.options.range);
					}
					if (event.options.dynRatioShow === true) {
						await sendOscDynMessages(event.options.channel, 2, 'ratio', event.options.ratio);
					}
					if (event.options.dynAttackShow === true) {
						await sendOscDynMessages(event.options.channel, 2, 'attack', event.options.attack / 1000);
					}
					if (event.options.dynHoldShow === true) {
						await sendOscDynMessages(event.options.channel, 2, 'hold', event.options.hold / 1000);
					}
					if (event.options.dynReleaseShow === true) {
						await sendOscDynMessages(event.options.channel, 2, 'release', event.options.release / 1000);
					}
					if (event.options.kneeShow === true) {
						await sendOscDynMessages(event.options.channel, 2, 'knee', event.options.knee, 'i');
					}
					if (event.options.lpfreqShow === true) {
						await sendOscDynMessages(event.options.channel, 2, 'crossover_low', event.options.lpfrequency);
					}
					if (event.options.hpfreqShow === true) {
						await sendOscDynMessages(event.options.channel, 2, 'crossover_high', event.options.hpfrequency);
					}
				},
			},
			mute_enable: {
				name: 'Channel Mute/Unmute',
				options: [
					{
						id:"channel",
						type: 'number',
						label: 'Refer channel number according to the OSC page of your console',
						default: 1,
						min: 1,
						max: 120,
						useVariables: true,
						tooltip: 'Inputs: 1-60 | Aux/Groups: 70-94 | Master: 120 | Matrix: 100-107 | CG: 110-119',
					},
					{
						type: 'dropdown',
						label: 'Mute/Unmute',
						choices: [
							{ id: 'true', label: 'Mute' },
							{ id: 'false', label: 'Unmute' },
						],
						id: 'mute',
						default: 'false',
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
				name: 'Channel Delay',
				options: [
					{
						id:"channel",
						type: 'number',
						label: 'Refer channel number according to the OSC page of your console',
						default: 1,
						min: 1,
						max: 120,
						useVariables: true,
						tooltip: 'Inputs: 1-60 | Aux/Groups: 70-94 | Master: 120 | Matrix: 100-107 | CG: 110-119',
					},
					{
						type: 'checkbox',
						label: 'Delay Enable?',
						id: 'enabled',
						default: false,
						useVariables: true,
					},
					{
						id: 'delayValue',
						type: 'number',
						label: 'Delay Value',
						default: 0,
						min: 0,
						max: 682,
						isVisible: (options)=>options.enabled === true,
						useVariables: true,
						tooltip: '0 - 682',
					},
				],
				callback: async (event) => {
					if (event.options.enabled === false) {
						const path = '/channel/'+ event.options.channel + '/delay/enabled'
						const delayEnabled = await this.parseVariablesInString(event.options.enabled)
						
						sendOscMessage(path, [
							{
								type: 's',
								value: delayEnabled,
							},
						])
						this.handleIncomingData(event.options.channel, '/delay/enabled', delayEnabled)
					}
					if (event.options.enabled === true) {
						const path = '/channel/'+ event.options.channel + '/delay/enabled'
						const delayEnabled = await this.parseVariablesInString(event.options.enabled)
						
						sendOscMessage(path, [
							{
								type: 's',
								value: delayEnabled,
							},
						])
						this.handleIncomingData(event.options.channel, '/delay/enabled', delayEnabled)
					}
					if (event.options.enabled === true) {
						const path = '/channel/'+ event.options.channel + '/delay/time'
						const delayValue = await this.parseVariablesInString(event.options.delayValue / 1000)
						
						sendOscMessage(path, [
							{
								type: 's',
								value: delayValue,
							},
						])
						this.handleIncomingData(event.options.channel, '/delay/time', delayValue)
					}
				},
			},
			digitube: {
				name: 'Channel DiGiTube',
				options: [
					{
						id:"channel",
						type: 'number',
						label: 'Refer channel number according to the OSC page of your console',
						default: 1,
						min: 1,
						max: 120,
						useVariables: true,
						tooltip: 'Inputs: 1-60 | Aux/Groups: 70-94 | Master: 120 | Matrix: 100-107 | CG: 110-119',
					},
					{
						type: 'checkbox',
						label: 'Enable/Disable DiGiTube?',
						id: 'digitubeShow',
						default: false,
						useVariables: true,
					},
					{
						id:"bias",
						type: 'number',
						label: 'DiGiTube Bias',
						default: 0,
						min: 1,
						max: 10,
						regex: Regex.SIGNED_NUMBER,
						useVariables: true,
						isVisible: (options)=>options.digitubeShow === true,
						tooltip: 'TBD Value',
					},
					{
						id:"drive",
						type: 'number',
						label: 'DiGiTube Drive',
						default: 0,
						min: 0.5,
						max: 50,
						useVariables: true,
						isVisible: (options)=>options.digitubeShow === true,
						tooltip: '0.5-50',
					},
				],
				callback: async (event) => {
					if (event.options.digitubeShow === false) {
						const path = '/channel/'+ event.options.channel + '/digitube/enabled'
						const digitubeEnable = await this.parseVariablesInString(event.options.digitubeShow)
						
						sendOscMessage(path, [
							{
								type: 's',
								value: digitubeEnable,
							},
						])
						this.handleIncomingData(event.options.channel, '/digitube/enabled', digitubeEnable)
					}
					if (event.options.digitubeShow === true) {
						const path = '/channel/'+ event.options.channel + '/digitube/enabled'
						const digitubeEnable = await this.parseVariablesInString(event.options.digitubeShow)
						
						sendOscMessage(path, [
							{
								type: 's',
								value: digitubeEnable,
							},
						])
						this.handleIncomingData(event.options.channel, '/digitube/enabled', digitubeEnable)
					}
					if (event.options.digitubeShow === true) {
						const path = '/channel/'+ event.options.channel + '/digitube/bias'
						const value = await this.parseVariablesInString(event.options.bias)
						
						sendOscMessage(path, [
							{
								type: 'I',
								value: value,
							},
						])
						this.handleIncomingData(event.options.channel, '/digitube/enabled', value)
					}
					if (event.options.digitubeShow === true) {
						const path = '/channel/'+ event.options.channel + '/digitube/drive'
						const value = await this.parseVariablesInString(event.options.drive)
						
						sendOscMessage(path, [
							{
								type: 's',
								value: value,
							},
						])
						this.handleIncomingData(event.options.channel, '/digitube/drive', value)
					}
				},
			},
			gain: {
				name: 'Channel Gain Control',
				options: [
					{
						id:"channel",
						type: 'number',
						label: 'Refer channel number according to the OSC page of your console',
						default: 1,
						min: 1,
						max: 60,
						useVariables: true,
						tooltip: 'Inputs: 1-60',
					},
					{
						type: 'dropdown',
						label: 'Enable/Disable Gain Tracking?',
						id: 'trackingShow',
						choices: [
							{ id: 'true', label: 'Enable' },
							{ id: 'false', label: 'Disable' },
						],
						default: 'false',
						useVariables: true,
					},
					{
						type: 'checkbox',
						label: 'Adjust Gain?',
						id: 'gainShow',
						default: false,
						useVariables: true,
					},
					{
						id:"gain",
						type: 'number',
						label: 'Input Gain',
						default: 0,
						min: -150,
						max: 30,
						useVariables: true,
						isVisible: (options)=>options.gainShow === true,
						tooltip: '-150 - 30',
					},
					{
						type: 'checkbox',
						label: 'Adjust Input Trim?',
						id: 'trimShow',
						default: false,
						useVariables: true,
					},
					{
						id:"trim",
						type: 'number',
						label: 'Input Trim',
						default: 0,
						min: -40,
						max: 40,
						useVariables: true,
						isVisible: (options)=>options.trimShow === true,
						tooltip: '-40 - 40',
					},
				],
				callback: async (event) => {
					if (event.options.trackingShow === false) {
						const path = '/channel/'+ event.options.channel + '/input/gain_tracking'
						const trackingEnabled = await this.parseVariablesInString(event.options.trackingShow)
						
						sendOscMessage(path, [
							{
								type: 's',
								value: trackingEnabled,
							},
						])
						this.handleIncomingData(event.options.channel, '/input/gain_tracking', trackingEnabled)
					}
					if (event.options.trackingShow === true) {
						const path = '/channel/'+ event.options.channel + '/input/gain_tracking'
						const trackingEnabled = await this.parseVariablesInString(event.options.trackingShow)
						
						sendOscMessage(path, [
							{
								type: 's',
								value: trackingEnabled,
							},
						])
						this.handleIncomingData(event.options.channel, '/input/gain_tracking', trackingEnabled)
					}
					if (event.options.gainShow === true) {
						const path = '/channel/'+ event.options.channel + '/input/gain'
						const gainValue = await this.parseVariablesInString(event.options.gain)
						
						sendOscMessage(path, [
							{
								type: 's',
								value: gainValue,
							},
						])
						this.handleIncomingData(event.options.channel, '/input/gain', gainValue)
					}
				},
			},
			name: {
				name: 'Channel Name',
				options: [
					{
						id:"channel",
						type: 'number',
						label: 'Refer channel number according to the OSC page of your console',
						default: 1,
						min: 1,
						max: 120,
						useVariables: true,
						tooltip: 'Inputs: 1-60 | Aux/Groups: 70-94 | Master: 120 | Matrix: 100-107 | CG: 110-119',
					},
					{
						type: 'textinput',
						label: 'Channel Name',
						id: 'name',
						useVariables: true,
						minIsNegativeInfinity: true,
					},
				],
				callback: async (event) => {
					const path = '/channel/'+ event.options.channel + '/input/name'
					const name = await this.parseVariablesInString(event.options.name)

					sendOscMessage(path, [
						{
							type: 's',
							value: '' + name,
						},
					])
				},
			},
			fader: {
				name: 'Channel Fader',
				options: [
					{
						id:"channel",
						type: 'number',
						label: 'Refer channel number according to the OSC page of your console',
						default: 1,
						min: 1,
						max: 120,
						useVariables: true,
						tooltip: 'Inputs: 1-60 | Aux/Groups: 70-94 | Master: 120 | Matrix: 100-107 | CG: 110-119',
					},
					{
						type: 'number',
						label: 'Fader Value',
						id: 'fader',
						range: true,
						min: -150,
						max: 10,
						step: 0.1,
						default: '0',
						useVariables: true,
						minIsNegativeInfinity: true,
					},
				],
				callback: async (event) => {
					const path = '/channel/'+ event.options.channel + '/input/fader'
					const fader = await this.parseVariablesInString(event.options.fader)

					sendOscMessage(path, [
						{
							type: 'f',
							value: parseFloat(fader),
						},
					])
				},
			},
			pan: {
				name: 'Channel Pan',
				options: [
					{
						id:"channel",
						type: 'number',
						label: 'Refer channel number according to the OSC page of your console',
						default: 1,
						min: 1,
						max: 120,
						useVariables: true,
						tooltip: 'Inputs: 1-60 | Aux/Groups: 70-94 | Master: 120 | Matrix: 100-107 | CG: 110-119',
					},
					{
						type: 'number',
						label: 'Pan Value',
						id: 'pan',
						range: true,
						min: -10,
						max: 10,
						default: '0',
						useVariables: true,
					},
				],
				callback: async (event) => {
					const path = '/channel/'+ event.options.channel + '/pan'
					const pan = await this.parseVariablesInString(event.options.pan / 10)

					sendOscMessage(path, [
						{
							type: 'f',
							value: parseFloat(pan),
						},
					])
				},
			},
			width: {
				name: 'Channel Mono/Stereo',
				options: [
					{
						id: "channel",
						type: 'number',
						label: 'Refer channel number according to the OSC page of your console',
						default: 1,
						min: 1,
						max: 120,
						useVariables: true,
						tooltip: 'Inputs: 1-60 | Aux/Groups: 70-94 | Master: 120 | Matrix: 100-107 | CG: 110-119',
					},
					{
						type: 'dropdown',
						label: 'Mono/Stereo',
						id: 'width',
						choices: [
							{ id: '-1', label: 'Mono' },
							{ id: '1', label: 'Stereo' },
						],
						default: 'mono',
						useVariables: true,
					},
				],
				callback: async (event) => {
					const path = '/channel/'+ event.options.channel + '/input/width'
					const width = await this.parseVariablesInString(event.options.width)

					sendOscMessage(path, [
						{
							type: 'f',
							value: parseFloat(width),
						},
					])
				},
			},
			outputassign: {
				name: 'Aux/Group/CG Assign',
				options: [
					{
						id: "input",
						type: 'number',
						label: 'Refer channel number according to the OSC page of your console',
						default: 1,
						min: 1,
						max: 60,
						useVariables: true,
						tooltip: 'Inputs: 1-60',
					},
					{
						id: "output",
						type: 'number',
						label: 'Refer channel number according to the OSC page of your console',
						default: 70,
						min: 70,
						max: 120,
						useVariables: true,
						tooltip: 'Aux/Groups: 70-94 | Master: 120 | CG: 110-119',
					},
					{
						id: "enabled",
						type: 'dropdown',
						label: 'Enable/Disable Send',
						choices: [
							{ id: 'true', label: 'Enable' },
							{ id: 'false', label: 'Disable' },
						],
						default: 'false',
						useVariables: true,
					},
					{
						id: "levelshow",
						type: 'checkbox',
						label: 'Adjust Send Level?',
						default: false,
						useVariables: true,
						isVisible:  (options)=>options.enabled === 'true',
					},
					{
						type: 'number',
						label: 'Send Value',
						id: 'level',
						range: true,
						min: -90,
						max: 10,
						step: 0.1,
						default: '0',
						useVariables: true,
						isVisible:  (options)=>options.enabled === 'true' && options.levelshow === true,
					},
					{
						id: "panshow",
						type: 'checkbox',
						label: 'Adjust Send Pan?',
						default: false,
						useVariables: true,
						isVisible:  (options)=>options.enabled === 'true',
					},
					{
						type: 'number',
						label: 'Pan Value',
						id: 'pan',
						range: true,
						min: -10,
						max: 10,
						default: '0',
						useVariables: true,
						isVisible:  (options)=>options.enabled === 'true' && options.panshow === true,
					},
				],
				callback: async (event) => {
					if (event.options.enabled === false) {
						const path = '/channel/' + event.options.input + '/send/' + event.options.output + '/enabled'
						const enabled = await this.parseVariablesInString(event.options.enabled)
						
						sendOscMessage(path, [
							{
								type: 's',
								value: enabled,
							},
						])
					}
				},
				callback: async (event) => {
					if (event.options.enabled === true) {
						const path = '/channel/' + event.options.input + '/send/' + event.options.output + '/enabled'
						const enabled = await this.parseVariablesInString(event.options.enabled)
						
						sendOscMessage(path, [
							{
								type: 's',
								value: enabled,
							},
						])
					}
				},
				callback: async (event) => {
					if (event.options.levelshow === true) {
						const path = '/channel/' + event.options.input + '/send/' + event.options.output + '/level'
						const level = await this.parseVariablesInString(event.options.level)
						
						sendOscMessage(path, [
							{
								type: 'f',
								value: parseFloat(level),
							},
						])
					}
				},
				callback: async (event) => {
					if (event.options.panshow === true) {
						const path = '/channel/' + event.options.input + '/send/' + event.options.output + '/pan'
						const pan = await this.parseVariablesInString(event.options.pan / 10)
						
						sendOscMessage(path, [
							{
								type: 'f',
								value: parseFloat(pan),
							},
						])
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
				description: 'Listen for OSC messages. Requires "Listen for Feedback" option to be enabled in web config.',
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
				description: 'Listen for OSC messages. Requires "Listen for Feedback" option to be enabled in web config.',
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