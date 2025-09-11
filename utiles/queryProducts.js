class queryProducts {
    products = []
    query = {}
    constructor(products, query) {
        this.products = products
        this.query = query
    }

    // NEW: Add status filter method
    statusFilter = () => {
        // Only filter if we're not in admin context
        if (!this.query.isAdmin) {
            this.products = this.products.filter(p => p.status === 'approved');
        }
        return this;
    }

    categoryQuery = () => {
        this.products = this.query.category ? 
            this.products.filter(c => c.category === this.query.category) : 
            this.products;
        return this
    }

    ratingQuery = () => {
        this.products = this.query.rating ? 
            this.products.filter(c => parseInt(this.query.rating) <= c.rating && 
                                      c.rating < parseInt(this.query.rating) + 1) : 
            this.products;
        return this
    }

    priceQuery = () => {
        if (this.query.lowPrice && this.query.highPrice) {
            this.products = this.products.filter(p => 
                p.price >= this.query.lowPrice && 
                p.price <= this.query.highPrice
            );
        }
        return this
    }

    searchQuery = () => {
        if (this.query.searchValue) {
            const searchUpper = this.query.searchValue.toUpperCase();
            this.products = this.products.filter(p => 
                p.name.toUpperCase().includes(searchUpper) ||
                (p.description && p.description.toUpperCase().includes(searchUpper)) ||
                p.category.toUpperCase().includes(searchUpper)
            );
        }
        return this
    }

    sortByPrice = () => {
        if (this.query.sortPrice) {
            if (this.query.sortPrice === 'low-to-high') {
                this.products = this.products.sort((a, b) => a.price - b.price);
            } else {
                this.products = this.products.sort((a, b) => b.price - a.price);
            }
        }
        return this
    }

    skip = () => {
        if (this.query.pageNumber && this.query.parPage) {
            const skipPage = (parseInt(this.query.pageNumber) - 1) * parseInt(this.query.parPage);
            this.products = this.products.slice(skipPage);
        }
        return this
    }

    limit = () => {
        if (this.query.parPage) {
            const parPage = parseInt(this.query.parPage);
            this.products = this.products.slice(0, parPage);
        }
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