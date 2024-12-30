// popup.js
class PopupManager {
    constructor() {
        this.initializeElements();
        this.setupEventListeners();
        this.loadStatus();
    }

    initializeElements() {
        this.psychonautStatus = document.getElementById('psychonautStatus');
        this.tripSitStatus = document.getElementById('tripSitStatus');
        this.toggleButton = document.getElementById('toggleHighlighting');
        this.optionsButton = document.getElementById('openOptions');
        this.highlightCount = document.getElementById('highlightCount');
        this.lastUpdate = document.getElementById('lastUpdate');
    }

    setupEventListeners() {
        this.toggleButton.addEventListener('click', () => this.toggleHighlighting());
        this.optionsButton.addEventListener('click', () => this.openOptions());
        
        // Check API status every 30 seconds
        this.checkAPIStatus();
        setInterval(() => this.checkAPIStatus(), 30000);
    }

    async loadStatus() {
        chrome.storage.sync.get(['isEnabled', 'highlightCount', 'lastUpdate'], (data) => {
            this.toggleButton.textContent = data.isEnabled ? 'Disable Highlighting' : 'Enable Highlighting';
            this.highlightCount.textContent = data.highlightCount || '0';
            this.lastUpdate.textContent = data.lastUpdate ? 
                `Last updated: ${new Date(data.lastUpdate).toLocaleString()}` : 
                'Last updated: Never';
        });
    }

    async checkAPIStatus() {
        // Check PsychonautWiki API
        try {
            const psychonautResponse = await fetch('https://api.psychonautwiki.org', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: '{ substances(limit: 1) { name } }' })
            });
            this.updateStatusIndicator(this.psychonautStatus, psychonautResponse.ok);
        } catch (error) {
            this.updateStatusIndicator(this.psychonautStatus, false);
        }

        // Check TripSit API
        try {
            const tripSitResponse = await fetch('https://tripbot.tripsit.me/api/tripsit/getDrug?name=LSD');
            this.updateStatusIndicator(this.tripSitStatus, tripSitResponse.ok);
        } catch (error) {
            this.updateStatusIndicator(this.tripSitStatus, false);
        }
    }

    updateStatusIndicator(element, isActive) {
        element.className = `indicator ${isActive ? 'active' : 'inactive'}`;
    }

    async toggleHighlighting() {
        chrome.storage.sync.get(['isEnabled'], (data) => {
            const newState = !data.isEnabled;
            chrome.storage.sync.set({ isEnabled: newState }, () => {
                this.toggleButton.textContent = newState ? 'Disable Highlighting' : 'Enable Highlighting';
                
                // Notify content script
                chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
                    chrome.tabs.sendMessage(tabs[0].id, {
                        type: 'TOGGLE_HIGHLIGHTING',
                        enabled: newState
                    });
                });
            });
        });
    }

    openOptions() {
        chrome.runtime.openOptionsPage();
    }
}

// Initialize the popup
document.addEventListener('DOMContentLoaded', () => {
    new PopupManager();
});