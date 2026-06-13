export class BudgetEnforcer {
  private budgetUSD: number;
  private getCost: () => number;

  constructor(budgetUSD: number, getCost: () => number) {
    this.budgetUSD = budgetUSD;
    this.getCost = getCost;
  }

  isExceeded(): boolean {
    return this.budgetUSD > 0 && this.getCost() >= this.budgetUSD;
  }

  remaining(): number {
    return Math.max(0, this.budgetUSD - this.getCost());
  }
}
