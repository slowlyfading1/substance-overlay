class SubstanceList {
    constructor() {
        this.substances = new Set([
            // Common substances
            'Cocaine', 'Heroin', 'Methamphetamine', 'MDMA', 'LSD',
            'Cannabis', 'Marijuana', 'Ketamine', 'Alcohol', 'Nicotine',
            'Caffeine', 'Psilocybin', 'DMT', 'Amphetamine', 'Morphine',
            'Codeine', 'Oxycodone', 'Xanax', 'Valium', 'Adderall',
            // Additional substances
            'Alprazolam', 'Diazepam', 'Clonazepam', 'Lorazepam',
            'Fentanyl', 'Hydrocodone', 'Tramadol', 'Methadone',
            'PCP', 'GHB', 'Mescaline', '2C-B', 'NBOMe', 'Salvia',
            'Kratom', 'DXM', 'Nitrous', 'Khat', 'Modafinil'
        ]);
        
        // Comprehensive alternate names and variations
        this.alternateNames = new Map([
            ['Cannabis', ['Weed', 'Pot', 'Marijuana', 'THC', 'Grass', 'Hash', 'Hemp']],
            ['MDMA', ['Ecstasy', 'Molly', 'XTC', 'E', 'Roll', 'Bean', 'Adam']],
            ['Cocaine', ['Coke', 'Crack', 'Snow', 'Blow', 'White', 'Nose Candy']],
            ['Methamphetamine', ['Meth', 'Crystal', 'Ice', 'Glass', 'Tina', 'Crank', 'Speed']],
            ['Heroin', ['Dope', 'Smack', 'H', 'Horse', 'Tar', 'Brown']],
            ['LSD', ['Acid', 'Lucy', 'Tabs', 'Paper', 'Blotter', 'Dots']],
            ['Psilocybin', ['Mushrooms', 'Shrooms', 'Magic Mushrooms', 'Caps', 'Boomers']],
            ['Ketamine', ['K', 'Special K', 'Kit Kat', 'Cat Valium']],
            ['Alprazolam', ['Xanax', 'Bars', 'Planks', 'Sticks']],
            ['Diazepam', ['Valium', 'Blues', 'Benzos']],
            ['GHB', ['G', 'Liquid X', 'Georgia Home Boy']],
            ['PCP', ['Angel Dust', 'Dust', 'Wet']],
            ['DMT', ['Dimitri', 'Spirit Molecule', 'Businessman's Trip']],
            ['Nitrous', ['Laughing Gas', 'Whippits', 'Nos']],
            ['Amphetamine', ['Speed', 'Pep', 'Uppers']],
            ['DXM', ['Robotussin', 'Robo', 'Triple C']],
            ['2C-B', ['Nexus', 'Venus', 'Bees']],
            ['Modafinil', ['Provigil', 'Moda']],
            ['Fentanyl', ['China White', 'Apache', 'China Girl']],
            ['Oxycodone', ['Oxy', 'OC', 'Kicker']]
        ]);

        this.settings = {
            caseSensitive: false,
            wholeWord: true,
            fuzzyMatch: false
        };

        this.buildRegexPattern();
    }

    addSubstance(substance, alternates = []) {
        if (typeof substance !== 'string' || !substance.trim()) return false;
        
        substance = substance.trim();
        this.substances.add(substance);
        
        if (Array.isArray(alternates) && alternates.length > 0) {
            const validAlternates = alternates
                .filter(alt => typeof alt === 'string' && alt.trim())
                .map(alt => alt.trim());
                
            if (validAlternates.length > 0) {
                this.alternateNames.set(substance, validAlternates);
            }
        }
        
        this.buildRegexPattern();
        return true;
    }

    removeSubstance(substance) {
        const removed = this.substances.delete(substance);
        this.alternateNames.delete(substance);
        
        if (removed) {
            this.buildRegexPattern();
        }
        return removed;
    }

    buildRegexPattern() {
        try {
            const patterns = [];
            
            // Process main substances and their alternates
            for (const substance of this.substances) {
                // Add the main substance
                patterns.push(this.escapeRegExp(substance));
                
                // Add alternate names
                const alternates = this.alternateNames.get(substance);
                if (alternates) {
                    alternates.forEach(alt => {
                        if (alt && typeof alt === 'string') {
                            patterns.push(this.escapeRegExp(alt.trim()));
                        }
                    });
                }
            }

            // Remove duplicates and sort by length (longest first)
            const uniquePatterns = [...new Set(patterns)]
                .filter(pattern => pattern.length > 0)
                .sort((a, b) => b.length - a.length);

            // Build the final pattern
            const patternStr = uniquePatterns.join('|');
            const flags = this.settings.caseSensitive ? 'g' : 'gi';
            
            this.pattern = new RegExp(
                this.settings.wholeWord ? 
                    `\\b(${patternStr})\\b` : 
                    `(${patternStr})`,
                flags
            );
            
            return true;
        } catch (error) {
            console.error('Failed to build regex pattern:', error);
            this.pattern = null;
            return false;
        }
    }

    escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    findMatches(text) {
        if (!text || typeof text !== 'string' || !this.pattern) return [];
        
        const matches = [];
        let match;
        
        // Reset lastIndex to ensure we start from the beginning
        this.pattern.lastIndex = 0;
        
        while ((match = this.pattern.exec(text)) !== null) {
            // Get the normalized form of the matched substance
            const normalizedMatch = this.getNormalizedSubstance(match[0]);
            
            matches.push({
                substance: match[0],
                normalizedSubstance: normalizedMatch,
                index: match.index,
                length: match[0].length,
                originalText: match[0]
            });
        }
        
        return matches;
    }

    getNormalizedSubstance(match) {
        // Find the main substance name for any alternate names
        for (const [substance, alternates] of this.alternateNames.entries()) {
            if (this.compareStrings(substance, match) || 
                alternates.some(alt => this.compareStrings(alt, match))) {
                return substance;
            }
        }
        return match;
    }

    compareStrings(str1, str2) {
        if (!this.settings.caseSensitive) {
            str1 = str1.toLowerCase();
            str2 = str2.toLowerCase();
        }
        return str1 === str2;
    }

    getPattern() {
        return this.pattern;
    }

    getAllSubstances() {
        return Array.from(this.substances);
    }

    loadCustomSubstances(customSubstances) {
        if (!Array.isArray(customSubstances)) return false;
        
        let updated = false;
        customSubstances.forEach(substance => {
            if (typeof substance === 'string' && substance.trim()) {
                this.substances.add(substance.trim());
                updated = true;
            } else if (typeof substance === 'object' && substance.name) {
                this.addSubstance(substance.name, substance.alternates);
                updated = true;
            }
        });
        
        if (updated) {
            this.buildRegexPattern();
        }
        
        return updated;
    }

    getAllSubstancesWithAlternates() {
        const all = new Set(this.substances);
        
        this.alternateNames.forEach((alternates, main) => {
            alternates.forEach(alt => all.add(alt));
        });
        
        return Array.from(all).sort();
    }

    updateSettings(newSettings = {}) {
        this.settings = {
            ...this.settings,
            ...newSettings
        };
        
        this.buildRegexPattern();
    }

    clearSubstances() {
        this.substances.clear();
        this.alternateNames.clear();
        this.buildRegexPattern();
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SubstanceList;
} else {
    window.SubstanceList = SubstanceList;
}