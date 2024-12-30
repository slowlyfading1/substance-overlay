class SubstanceUtils {
    static async validateSubstance(name) {
        try {
            const [psychonautResult, tripSitResult] = await Promise.all([
                this.checkPsychonautWiki(name),
                this.checkTripSit(name)
            ]);
            
            return {
                isValid: psychonautResult || tripSitResult,
                sources: {
                    psychonaut: psychonautResult,
                    tripSit: tripSitResult
                }
            };
        } catch (error) {
            console.error('Substance validation error:', error);
            return { isValid: false, sources: { psychonaut: false, tripSit: false } };
        }
    }

    static async getSubstanceInfo(name) {
        const info = {
            name: name,
            data: {},
            sources: []
        };

        try {
            // Try PsychonautWiki first
            const psychonautData = await this.fetchPsychonautData(name);
            if (psychonautData) {
                info.data = { ...info.data, ...psychonautData };
                info.sources.push('PsychonautWiki');
            }

            // Then TripSit
            const tripSitData = await this.fetchTripSitData(name);
            if (tripSitData) {
                info.data = { ...info.data, ...tripSitData };
                info.sources.push('TripSit');
            }

            return info;
        } catch (error) {
            console.error('Error fetching substance info:', error);
            return null;
        }
    }
}