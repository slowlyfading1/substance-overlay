class SubstanceHighlighter {
    constructor() {
        this.settings = {};
        this.api = null;
        this.observer = null;
        this.processedNodes = new WeakSet();
        this.tooltip = null;
        this.throttleTimeout = null;
        this.THROTTLE_DELAY = 100;
        this.BATCH_SIZE = 50;
        this.BATCH_DELAY = 10;
        this.EXCLUDED_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT']);
        this.initialized = false;
        this.currentTooltipElement = null;
        this.substancePatterns = null;
        this.processingQueue = [];
        this.isProcessing = false;
        
        this.initialize();
    }

    async initialize() {
        if (this.initialized) return;
        
        try {
            // Load settings
            const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
            this.settings = response.settings || {};

            // Initialize API
            this.api = new SubstanceAPI(this.settings);

            // Initialize substance patterns
            await this.initializeSubstancePatterns();

            // Setup styles
            this.updateHighlightStyles();
            
            // Create tooltip
            this.createTooltip();
            
            // Setup observers and listeners
            this.setupMutationObserver();
            this.setupMessageListener();
            this.setupScrollListener();
            
            // Initial scan
            await this.scanPage();
            
            this.initialized = true;
        } catch (error) {
            console.error('Failed to initialize SubstanceHighlighter:', error);
        }
    }

    async initializeSubstancePatterns() {
        try {
            // Get substance list from both APIs
            const substances = new Set();
            
            if (this.settings.enablePsychonautWiki) {
                const psychonautResponse = await this.api.makeGraphQLRequest(`
                    query {
                        substances {
                            name
                            commonNames
                        }
                    }
                `);
                
                if (psychonautResponse?.data?.substances) {
                    for (const substance of psychonautResponse.data.substances) {
                        substances.add(substance.name.toLowerCase());
                        if (substance.commonNames) {
                            substance.commonNames.forEach(name => 
                                substances.add(name.toLowerCase())
                            );
                        }
                    }
                }
            }
            
            if (this.settings.enableTripSit) {
                const tripSitResponse = await this.api.makeAPIRequest(
                    this.api.API_ENDPOINTS.TRIPSIT_ALL
                );
                
                if (tripSitResponse?.data?.data?.drugs) {
                    Object.values(tripSitResponse.data.data.drugs).forEach(drug => {
                        if (drug.name) substances.add(drug.name.toLowerCase());
                        if (drug.aliases) {
                            drug.aliases.forEach(alias => 
                                substances.add(alias.toLowerCase())
                            );
                        }
                    });
                }
            }

            // Add custom substances from settings
            if (Array.isArray(this.settings.customSubstances)) {
                this.settings.customSubstances.forEach(substance => 
                    substances.add(substance.toLowerCase())
                );
            }

            // Create pattern
            if (substances.size > 0) {
                const escapedSubstances = Array.from(substances)
                    .map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
                    .sort((a, b) => b.length - a.length); // Sort by length descending
                
                this.substancePatterns = new RegExp(
                    `\\b(${escapedSubstances.join('|')})\\b`, 
                    'gi'
                );
            }
        } catch (error) {
            console.error('Failed to initialize substance patterns:', error);
            this.substancePatterns = null;
        }
    }

    setupMutationObserver() {
        if (this.observer) {
            this.observer.disconnect();
        }

        this.observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'childList') {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            this.queueNodeForProcessing(node);
                        }
                    }
                }
            }
        });

        this.observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    setupMessageListener() {
        chrome.runtime.onMessage.addListener(async (message) => {
            if (message.type === 'SETTINGS_UPDATED') {
                this.settings = message.settings;
                this.api.settings = message.settings;
                await this.initializeSubstancePatterns();
                this.updateHighlightStyles();
                this.clearProcessedNodes();
                await this.scanPage();
            }
        });
    }

    setupScrollListener() {
        window.addEventListener('scroll', () => {
            if (this.tooltip && this.currentTooltipElement) {
                this.updateTooltipPosition(this.currentTooltipElement);
            }
        }, { passive: true });
    }

    createTooltip() {
        if (this.tooltip) {
            document.body.removeChild(this.tooltip);
        }
        
        this.tooltip = document.createElement('div');
        this.tooltip.className = 'substance-tooltip';
        this.tooltip.style.display = 'none';
        document.body.appendChild(this.tooltip);
    }

    updateHighlightStyles() {
        const styleId = 'substance-highlight-styles';
        let styleElement = document.getElementById(styleId);
        
        if (!styleElement) {
            styleElement = document.createElement('style');
            styleElement.id = styleId;
            document.head.appendChild(styleElement);
        }

        styleElement.textContent = `
            .substance-highlight {
                background-color: ${this.settings.highlightColor || '#ffeb3b'};
                opacity: 0.7;
                cursor: help;
                border-bottom: 2px solid rgba(0, 0, 0, 0.2);
                transition: all 0.2s ease-in-out;
                position: relative;
                display: inline-block;
                padding: 0 2px;
                border-radius: 2px;
            }
            .substance-highlight:hover {
                opacity: 1;
                background-color: ${this.settings.highlightColor || '#ffd700'};
            }
            .substance-tooltip {
                position: fixed;
                z-index: 10000;
                max-width: 400px;
                background: white;
                border: 1px solid rgba(0, 0, 0, 0.1);
                border-radius: 8px;
                padding: 16px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                font-size: 14px;
                line-height: 1.5;
                color: #333;
                transition: opacity 0.2s ease-in-out;
            }
            .substance-tooltip h3 {
                margin: 0 0 12px 0;
                color: #1a1a1a;
                font-size: 18px;
                font-weight: 600;
            }
            .substance-tooltip p {
                margin: 8px 0;
            }
            .substance-tooltip .tooltip-section {
                margin: 12px 0;
                padding: 8px;
                background: rgba(0, 0, 0, 0.02);
                border-radius: 4px;
            }
            .substance-tooltip .warning {
                background: rgba(255, 0, 0, 0.05);
                border-left: 4px solid #ff0000;
                padding-left: 12px;
            }
            .substance-tooltip .tooltip-footer {
                margin-top: 16px;
                padding-top: 12px;
                border-top: 1px solid rgba(0, 0, 0, 0.1);
                font-size: 12px;
                color: #666;
                text-align: right;
            }
        `;
    }

    queueNodeForProcessing(node) {
        this.processingQueue.push(node);
        this.processQueue();
    }

    async processQueue() {
        if (this.isProcessing || this.processingQueue.length === 0) return;
        
        this.isProcessing = true;
        
        try {
            while (this.processingQueue.length > 0) {
                const node = this.processingQueue.shift();
                await this.processNode(node);
                // Add small delay between nodes to prevent blocking
                await new Promise(resolve => setTimeout(resolve, 1));
            }
        } finally {
            this.isProcessing = false;
        }
    }

    async scanPage() {
        if (!this.substancePatterns) return;

        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: (node) => {
                    if (this.shouldProcessNode(node)) {
                        return NodeFilter.FILTER_ACCEPT;
                    }
                    return NodeFilter.FILTER_REJECT;
                }
            }
        );

        const textNodes = [];
        let node;
        while (node = walker.nextNode()) {
            textNodes.push(node);
        }

        // Process nodes in batches
        for (let i = 0; i < textNodes.length; i += this.BATCH_SIZE) {
            const batch = textNodes.slice(i, i + this.BATCH_SIZE);
            await this.processTextNodesBatch(batch);
            // Small delay between batches to prevent freezing
            await new Promise(resolve => setTimeout(resolve, this.BATCH_DELAY));
        }
    }

    clearProcessedNodes() {
        this.processedNodes = new WeakSet();
    }

    shouldProcessNode(node) {
        if (!node || !node.parentElement) return false;
        if (this.processedNodes.has(node)) return false;
        if (this.EXCLUDED_TAGS.has(node.parentElement.tagName)) return false;
        if (node.parentElement.closest('script, style, noscript, textarea, input')) return false;
        if (!node.textContent || node.textContent.trim().length < 2) return false;
        return true;
    }

    findSubstanceMatches(text) {
        if (!this.substancePatterns || !text) return [];
        
        const matches = [];
        let match;
        
        this.substancePatterns.lastIndex = 0; // Reset regex state
        while ((match = this.substancePatterns.exec(text)) !== null) {
            matches.push(match);
        }
        
        return matches;
    }

    async processNode(node) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) return;
        
        const walker = document.createTreeWalker(
            node,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: (node) => this.shouldProcessNode(node) ? 
                    NodeFilter.FILTER_ACCEPT : 
                    NodeFilter.FILTER_REJECT
            }
        );

        const textNodes = [];
        let textNode;
        while (textNode = walker.nextNode()) {
            textNodes.push(textNode);
        }

        await this.processTextNodesBatch(textNodes);
    }

    async processTextNodesBatch(nodes) {
        for (const node of nodes) {
            if (!this.processedNodes.has(node)) {
                await this.processTextNode(node);
                this.processedNodes.add(node);
            }
        }
    }

    async processTextNode(node) {
        if (!node || !node.textContent || this.processedNodes.has(node)) return;

        const text = node.textContent;
        const matches = this.findSubstanceMatches(text);
        
        if (matches.length === 0) return;

        const fragment = document.createDocumentFragment();
        let lastIndex = 0;

        for (const match of matches) {
            // Add text before the match
            if (match.index > lastIndex) {
                fragment.appendChild(
                    document.createTextNode(text.slice(lastIndex, match.index))
                );
            }

            // Create highlighted element
            const span = document.createElement('span');
            span.className = 'substance-highlight';
            span.textContent = match[0];
            span.dataset.substance = match[0];
            
            // Add event listeners
            span.addEventListener('mouseover', (e) => this.handleMouseOver(e));
            span.addEventListener('mouseout', (e) => this.handleMouseOut(e));
            
            fragment.appendChild(span);
            lastIndex = match.index + match[0].length;
        }

        // Add remaining text
        if (lastIndex < text.length) {
            fragment.appendChild(
                document.createTextNode(text.slice(lastIndex))
            );
        }

        // Replace the original node
        try {
            node.parentNode.replaceChild(fragment, node);
            this.processedNodes.add(node);
        } catch (error) {
            console.warn('Failed to replace node:', error);
        }
    }

    async handleMouseOver(event) {
        try {
            const highlightElement = event.target.closest('.substance-highlight');
            if (!highlightElement) return;

            const substanceName = highlightElement.dataset.substance;
            if (!substanceName) return;

            this.currentTooltipElement = highlightElement;

            // Show loading state
            this.showTooltip(highlightElement, { 
                name: substanceName,
                summary: 'Loading substance information...',
                source: 'Loading...'
            });

            // Fetch substance data
            let substanceData = null;
            
            if (this.settings.enablePsychonautWiki) {
                try {
                    const psychonautData = await this.api.getPsychonautWikiMatches([substanceName]);
                    if (psychonautData.has(substanceName)) {
                        substanceData = psychonautData.get(substanceName);
                    }
                } catch (error) {
                    console.warn('PsychonautWiki data fetch failed:', error);
                }
            }

            if (!substanceData && this.settings.enableTripSit) {
                try {
                    const tripSitData = await this.api.getTripSitMatches([substanceName]);
                    if (tripSitData.has(substanceName)) {
                        substanceData = tripSitData.get(substanceName);
                    }
                } catch (error) {
                    console.warn('TripSit data fetch failed:', error);
                }
            }

            if (substanceData) {
                this.showTooltip(highlightElement, substanceData);
            } else {
                this.showTooltip(highlightElement, {
                    name: substanceName,
                    summary: 'No detailed information available for this substance.',
                    source: 'No data found'
                });
            }
        } catch (error) {
            console.error('Error in handleMouseOver:', error);
            this.hideTooltip();
        }
    }

    handleMouseOut(event) {
        const highlightElement = event.target.closest('.substance-highlight');
        const tooltipElement = event.relatedTarget?.closest('.substance-tooltip');
        
        if (!tooltipElement && (!highlightElement || !highlightElement.contains(event.relatedTarget))) {
            this.hideTooltip();
        }
    }

    showTooltip(element, data) {
        if (!this.tooltip || !element || !data) return;

        this.tooltip.innerHTML = this.formatTooltipContent(data);
        this.tooltip.style.display = 'block';
        this.updateTooltipPosition(element);
    }

    hideTooltip() {
        if (this.tooltip) {
            this.tooltip.style.display = 'none';
            this.currentTooltipElement = null;
        }
    }

    updateTooltipPosition(element) {
        if (!this.tooltip || !element) return;

        const rect = element.getBoundingClientRect();
        const tooltipRect = this.tooltip.getBoundingClientRect();
        
        let left = rect.left + (rect.width - tooltipRect.width) / 2;
        let top = rect.bottom + 10;

        // Ensure tooltip stays within viewport
        const padding = 10;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        // Horizontal positioning
        if (left < padding) {
            left = padding;
        } else if (left + tooltipRect.width > viewportWidth - padding) {
            left = viewportWidth - tooltipRect.width - padding;
        }

        // Vertical positioning
        if (top + tooltipRect.height > viewportHeight - padding) {
            // Place above the element if there's not enough room below
            top = rect.top - tooltipRect.height - 10;
            
            // If there's not enough room above either, place it where more space is available
            if (top < padding) {
                const spaceAbove = rect.top;
                const spaceBelow = viewportHeight - rect.bottom;
                top = spaceBelow > spaceAbove ? 
                    rect.bottom + 10 : 
                    padding;
            }
        }

        this.tooltip.style.left = `${left}px`;
        this.tooltip.style.top = `${top}px`;
    }

    formatTooltipContent(data) {
        let content = `<h3>${data.name}</h3>`;

        if (data.summary) {
            content += `<p>${data.summary}</p>`;
        }

        if (this.settings.showDosage) {
            if (data.roas && data.roas.length > 0) {
                content += `
                    <div class="tooltip-section">
                        <strong>Dosage Information:</strong>
                        ${data.roas.map(roa => `
                            <div>
                                <p><em>${roa.name}:</em></p>
                                ${roa.dose ? `
                                    <ul>
                                        ${roa.dose.threshold ? `<li>Threshold: ${roa.dose.threshold}${roa.dose.units}</li>` : ''}
                                        ${roa.dose.common?.min ? `<li>Common: ${roa.dose.common.min}-${roa.dose.common.max}${roa.dose.units}</li>` : ''}
                                        ${roa.dose.heavy ? `<li>Heavy: ${roa.dose.heavy}${roa.dose.units}</li>` : ''}
                                    </ul>
                                ` : ''}
                            </div>
                        `).join('')}
                    </div>
                `;
            } else if (data.properties?.dosage) {
                content += `
                    <div class="tooltip-section">
                        <strong>Dosage:</strong>
                        <p>${data.properties.dosage}</p>
                    </div>
                `;
            }
        }

        if (this.settings.showEffects && data.properties?.effects) {
            content += `
                <div class="tooltip-section">
                    <strong>Effects:</strong>
                    <p>${Array.isArray(data.properties.effects) ? 
                        data.properties.effects.join(', ') : 
                        data.properties.effects}</p>
                </div>
            `;
        }

        if (this.settings.showWarnings) {
            if (data.properties?.warnings && data.properties.warnings.length > 0) {
                content += `
                    <div class="tooltip-section warning">
                        <strong>⚠️ Warnings:</strong>
                        <p>${Array.isArray(data.properties.warnings) ? 
                            data.properties.warnings.join('<br>') : 
                            data.properties.warnings}</p>
                    </div>
                `;
            }

            if (data.interactions) {
                let hasInteractions = false;
                let interactionsContent = '<div class="tooltip-section warning"><strong>⚠️ Interactions:</strong><ul>';

                if (data.interactions.dangerous?.length) {
                    hasInteractions = true;
                    interactionsContent += `
                        <li><strong>Dangerous:</strong> ${data.interactions.dangerous.map(i => i.name).join(', ')}</li>
                    `;
                }

                if (data.interactions.unsafe?.length) {
                    hasInteractions = true;
                    interactionsContent += `
                        <li><strong>Unsafe:</strong> ${data.interactions.unsafe.map(i => i.name).join(', ')}</li>
                    `;
                }

                if (data.interactions.uncertain?.length) {
                    hasInteractions = true;
                    interactionsContent += `
                        <li><strong>Uncertain:</strong> ${data.interactions.uncertain.map(i => i.name).join(', ')}</li>
                    `;
                }

                interactionsContent += '</ul></div>';

                if (hasInteractions) {
                    content += interactionsContent;
                }
            }
        }

        content += `
            <div class="tooltip-footer">
                Source: ${data.source}
            </div>
        `;

        return content;
    }
}

// Initialize the highlighter
const highlighter = new SubstanceHighlighter();