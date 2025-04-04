class queryProducts {
    products = []
    query = {}
    constructor(products, query) {
        this.products = products
        this.query = query
    }

    categoryQuery = () => {
        this.products = this.query.category ? this.products.filter(c => c.category === this.query.category) : this.products
        return this
    }

    ratingQuery = () => {
        this.products = this.query.rating ? this.products.filter(c => parseInt(this.query.rating) <= c.rating && c.rating < parseInt(this.query.rating) + 1) : this.products
        return this
    }

    priceQuery = () => {
        this.products = this.products.filter(p => p.price >= this.query.lowPrice && p.price <= this.query.highPrice)
        return this
    }

    searchQuery = () => {
        this.products = this.query.searchValue ? this.products.filter(p => p.name.toUpperCase().indexOf(this.query.searchValue.toUpperCase()) > -1) : this.products
        return this
    }

    // NEW METHOD FOR SEARCH SUGGESTIONS
   suggestionQuery = () => {
    const { q, suggestionLimit = 5 } = this.query;
    
    if (q && q.length >= 2) {
        const queryLower = q.toLowerCase().trim();
        const limit = Math.max(1, parseInt(suggestionLimit)) || 5; // Ensure valid number
        
        this.products = this.products
            .map(product => {
                // Calculate match score
                let score = 0;
                const nameLower = product.name.toLowerCase();
                const descLower = product.description?.toLowerCase() || '';
                
                // Name matches
                if (nameLower.includes(queryLower)) {
                    score += 3;
                    // Bonus for exact match
                    if (nameLower === queryLower) score += 2;
                    // Bonus for starts with
                    if (nameLower.startsWith(queryLower)) score += 1;
                }
                
                // Description matches
                if (descLower.includes(queryLower)) {
                    score += 1;
                    // Bonus for early mention
                    if (descLower.indexOf(queryLower) < 60) score += 1;
                }
                
                return { ...product, score };
            })
            .filter(p => p.score > 0) // Only keep matches
            .sort((a, b) => {
                // First sort by score descending
                if (b.score !== a.score) return b.score - a.score;
                // Then sort by name ascending for same scores
                return a.name.localeCompare(b.name);
            })
            .slice(0, limit)
            .map(({ score, ...rest }) => rest); // Remove temporary score
    }
    
    return this;
}

    sortByPrice = () => {
        if (this.query.sortPrice) {
            if (this.query.sortPrice === 'low-to-high') {
                this.products = this.products.sort(function (a, b) { return a.price - b.price })
            } else {
                this.products = this.products.sort(function (a, b) { return b.price - a.price })
            }
        }
        return this
    }

    skip = () => {
        let { pageNumber } = this.query
        const skipPage = (parseInt(pageNumber) - 1) * this.query.parPage

        let skipProduct = []

        for (let i = skipPage; i < this.products.length; i++) {
            skipProduct.push(this.products[i])
        }
        this.products = skipProduct
        return this
    }

    limit = () => {
        let temp = []
        if (this.products.length > this.query.parPage) {
            for (let i = 0; i < this.query.parPage; i++) {
                temp.push(this.products[i])
            }
        } else {
            temp = this.products
        }
        this.products = temp
        return this
    }

    getProducts = () => {
        return this.products
    }

    countProducts = () => {
        return this.products.length
    }
}

module.exports = queryProducts