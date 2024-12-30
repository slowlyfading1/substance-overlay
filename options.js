// options.js
class OptionsManager {
    constructor() {
        this.initializeElements();
        this.loadSettings();
        this.setupEventListeners();
    }

    initializeElements() {
        // Display settings
        this.highlightColor = document.getElementById('highlightColor');
        this.highlightColorText = document.getElementById('highlightColorText');

        // Information display
        this.showDosage = document.getElementById('showDosage');
        this.showDuration = document.getElementById('showDuration');
        this.showSafety = document.getElementById('showSafety');
        this.showInteractions = document.getElementById('showInteractions');

        // Data sources
        this.enablePsychonautWiki = document.getElementById('enablePsychonautWiki');
        this.enableTripSit = document.getElementById('enableTripSit');

        // Custom substances
        this.substanceList = document.getElementById('substanceList');
        this.newSubstance = document.getElementById('newSubstance');
        this.addSubstanceButton = document.getElementById('addSubstance');

        // Buttons
        this.saveButton = document.getElementById('saveSettings');
        this.resetButton = document.getElementById('resetSettings');
        this.statusMessage = document.getElementById('statusMessage');
    }

    setupEventListeners() {
        // Color picker sync
        this.highlightColor.addEventListener('input', () => {
            this.highlightColorText.value = this.highlightColor.value;
        });
        this.highlightColorText.addEventListener('input', () => {
            if (this.isValidColor(this.highlightColorText.value)) {
                this.highlightColor.value = this.highlightColorText.value;
            }
        });

        // Custom substances
        this.addSubstanceButton.addEventListener('click', () => this.addCustomSubstance());
        this.newSubstance.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.addCustomSubstance();
        });

        // Save and reset
        this.saveButton.addEventListener('click', () => this.saveSettings());
        this.resetButton.addEventListener('click', () => this.resetSettings());
    }

    async loadSettings() {
        const defaults = {
            highlightColor: '#ffff0066',
            showDosage: true,
            showDuration: true,
            showSafety: true,
            showInteractions: true,
            enablePsychonautWiki: true,
            enableTripSit: true,
            customSubstances: []
        };

        chrome.storage.sync.get(defaults, (settings) => {
            this.highlightColor.value = settings.highlightColor;
            this.highlightColorText.value = settings.highlightColor;
            this.showDosage.checked = settings.showDosage;
            this.showDuration.checked = settings.showDuration;
            this.showSafety.checked = settings.showSafety;
            this.showInteractions.checked = settings.showInteractions;
            this.enablePsychonautWiki.checked = settings.enablePsychonautWiki;
            this.enableTripSit.checked = settings.enableTripSit;
            
            this.renderCustomSubstances(settings.customSubstances);
        });
    }

    async saveSettings() {
        const settings = {
            highlightColor: this.highlightColor.value,
            showDosage: this.showDosage.checked,
            showDuration: this.showDuration.checked,
            showSafety: this.showSafety.checked,
            showInteractions: this.showInteractions.checked,
            enablePsychonautWiki: this.enablePsychonautWiki.checked,
            enableTripSit: this.enableTripSit.checked,
            customSubstances: this.getCustomSubstances()
        };

        chrome.storage.sync.set(settings, () => {
            this.showStatus('Settings saved successfully!', 'success');
            
            // Notify content scripts of settings update
            chrome.tabs.query({}, (tabs) => {
                tabs.forEach(tab => {
                    chrome.tabs.sendMessage(tab.id, { type: 'SETTINGS_UPDATED' });
                });
            });
        });
    }

    resetSettings() {
        if (confirm('Are you sure you want to reset all settings to defaults?')) {
            const defaults = {
                highlightColor: '#ffff0066',
                showDosage: true,
                showDuration: true,
                showSafety: true,
                showInteractions: true,
                enablePsychonautWiki: true,
                enableTripSit: true,
                customSubstances: []
            };

            chrome.storage.sync.set(defaults, () => {
                this.loadSettings();
                this.showStatus('Settings reset to defaults', 'success');
            });
        }
    }

    addCustomSubstance() {
        const substance = this.newSubstance.value.trim();
        if (substance) {
            const substances = this.getCustomSubstances();
            if (!substances.includes(substance)) {
                substances.push(substance);
                this.renderCustomSubstances(substances);
                this.newSubstance.value = '';
            }
        }
    }

    removeCustomSubstance(substance) {
        const substances = this.getCustomSubstances()
            .filter(s => s !== substance);
        this.renderCustomSubstances(substances);
    }

    getCustomSubstances() {
        return Array.from(this.substanceList.children)
            .map(item => item.querySelector('.substance-name').textContent);
    }

    renderCustomSubstances(substances) {
        this.substanceList.innerHTML = '';
        substances.forEach(substance => {
            const item = document.createElement('div');
            item.className = 'substance-item';
            item.innerHTML = `
                <span class="substance-name">${substance}</span>
                <button class="remove-substance" title="Remove substance">×</button>
            `;
            item.querySelector('.remove-substance').addEventListener('click', () => {
                this.removeCustomSubstance(substance);
            });
            this.substanceList.appendChild(item);
        });
    }

    showStatus(message, type) {
        this.statusMessage.textContent = message;
        this.statusMessage.className = `status-message ${type}`;
        this.statusMessage.style.display = 'block';
        setTimeout(() => {
            this.statusMessage.style.display = 'none';
        }, 3000);
    }

    isValidColor(color) {
        const s = new Option().style;
        s.color = color;
        return s.color !== '';
    }
}

// Initialize the options page
document.addEventListener('DOMContentLoaded', () => {
    new OptionsManager();
});