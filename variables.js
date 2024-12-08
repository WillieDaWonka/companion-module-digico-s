module.exports = {
    // Function to generate variable definitions dynamically
    getVariableDefinitions: function () {
        const variables = [];
        const paths = [
            'input/trim',
            'input/delay/time',
            'input/delay/enabled',
            'input/digitube/enabled',
            'input/digitube/bias',
            'input/digitube/drive',
            'input/width',
            'input/balance',
            'input/polarity',
            'input/gain_tracking',
            'input/name',
            'input/fader',
            'total/gain',
            'pan',
            'mute',
            'solo',
            'eq/enabled',
            'eq/highpass/frequency',
            'eq/highpass/enabled',
            'eq/lowpass/frequency',
            'eq/lowpass/enabled',
            'eq/{band}/frequency',
            'eq/{band}/gain',
            'eq/{band}/q',
            'eq/{band}/dyn/threshold',
            'eq/{band}/dyn/ratio',
            'eq/{band}/dyn/attack',
            'eq/{band}/dyn/release',
            'eq/{band}/dyn/enabled',
            'dyn1/enabled',
            'dyn1/mode',
            'dyn1/crossover_low',
            'dyn1/crossover_high',
            'dyn1/{band}/threshold',
            'dyn1/{band}/ratio',
            'dyn1/{band}/gain',
            'dyn1/{band}/attack',
            'dyn1/{band}/release',
            'dyn1/{band}/knee',
            'dyn1/{band}/listen',
            'dyn2/enabled',
            'dyn2/mode',
            'dyn2/gain',
            'dyn2/threshold',
            'dyn2/range',
            'dyn2/ratio',
            'dyn2/attack',
            'dyn2/hold',
            'dyn2/release',
            'dyn2/knee',
            'dyn2/listen',
            'dyn2/lowpass',
            'dyn2/highpass',
        ];

        for (let channel = 1; channel <= 120; channel++) {
            for (const path of paths) {
                if (path.indexOf('{band}') !== -1) {
                    for (let band = 1; band <= 4; band++) {
                        if (path.indexOf('dyn1') !== -1 && band == 4) continue;
                        const variableId = `channel_${channel}_${path.replace('{band}', band).replace(/\//g, '_')}`;
                        const variableName = `Channel ${channel} ${path.replace('{band}', band).replace(/\//g, ' ').replace(/_/g, ' ')}`;
                        variables.push({ variableId, name: variableName });
                    }
                    continue;
                }        
                const variableId = `channel_${channel}_${path.replace(/\//g, '_')}`;
                const variableName = `Channel ${channel} ${path.replace(/\//g, ' ').replace(/_/g, ' ')}`;
                variables.push({ variableId, name: variableName });
                
            }
        }

        return variables;
    },

    // Function to update variables dynamically
    updateVariables: function (instance, channel, path, value) {
        const variableId = `channel_${channel}_${path.replace(/\//g, '_')}`;
        const updates = { [variableId]: value };

        instance.updateVariables(updates);
    },

    // Function to update multiple variables at once
    updateMultipleVariables: function (instance, channel, data) {
        const updates = {};
        for (const [path, value] of Object.entries(data)) {
            const variableId = `channel_${channel}_${path.replace(/\//g, '_')}`;
            updates[variableId] = value;
        }

        instance.updateVariables(updates);
    },
};
