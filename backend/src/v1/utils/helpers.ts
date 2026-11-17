export const calculateTotalKpi = (
    appraisalScores: { score: number, kpiSubPoint: { kpiCategory: { weight: string, id: string, name: string } } }[],
    categorySubPointCounts?: { [key: string]: number }
) => {
    let totalScore = 0;

    // 1. Count how many sub-points (questions) exist in each category
    let categoryTotalSubPoints: { [key: string]: number } = {};

    appraisalScores.forEach(item => {
        const categoryId = item.kpiSubPoint.kpiCategory.id;
        if (!categoryTotalSubPoints[categoryId]) {
            categoryTotalSubPoints[categoryId] = 0;
        }
        categoryTotalSubPoints[categoryId] += 1; // Increment correctly
    });

    // 2. Override with team-specific counts if provided
    if (categorySubPointCounts) {
        Object.keys(categoryTotalSubPoints).forEach(categoryId => {
            if (categorySubPointCounts[categoryId]) {
                categoryTotalSubPoints[categoryId] = categorySubPointCounts[categoryId];
            }
        });
    }

    // 3. Calculate the weighted average
    appraisalScores.forEach((item) => {
        const categoryId = item.kpiSubPoint.kpiCategory.id;
        const categoryWeight = parseFloat(item.kpiSubPoint.kpiCategory.weight);
        const categoryName = item.kpiSubPoint.kpiCategory.name;

        // (score / 5) as our Rating is now from 1 to 5
        // multiplied by the weight (e.g. 40)                   
        // divided by the number of questions in that category to spread the weight evenly
        let weightedScore;
        if(categoryName.includes("HR") || categoryName.includes("hr")){
            
            // Normalize score out of 3 instead of 5, then distribute by category weight
            weightedScore = (item.score / 3) * (categoryWeight / categoryTotalSubPoints[categoryId]);
            
        } else {
            weightedScore = (item.score / 5) * (categoryWeight / categoryTotalSubPoints[categoryId]);
        }

        totalScore += weightedScore;
    });

    return totalScore;
}