module.exports = {
    getVariableDefinitions: function () {
        return [
            { variableId: 'status', name: 'Channel Status' },
            { variableId: 'volume', name: 'Channel Volume' },
            { variableId: 'mute', name: 'Mute Status' },
        ];
    },

    updateVariables: function (instance, data) {
        instance.updateVariables(data);
    },
}