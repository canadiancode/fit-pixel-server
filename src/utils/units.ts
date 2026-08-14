const ML_PER_OZ = 29.5735295625;

export function convertWaterAmount(
  amount: number,
  from: "oz" | "ml",
  to: "oz" | "ml",
): number {
  if (from === to) return amount;
  if (from === "oz" && to === "ml") return amount * ML_PER_OZ;
  return amount / ML_PER_OZ;
}

export function convertWeightValue(
  value: number,
  from: "lb" | "kg",
  to: "lb" | "kg",
): number {
  const KG_PER_LB = 0.45359237;
  if (from === to) return value;
  if (from === "lb" && to === "kg") return value * KG_PER_LB;
  return value / KG_PER_LB;
}
