
function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
  const toRadians = degrees => (degrees * Math.PI) / 180;
  const earthRadiusMeters = 6371000;

  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) ** 2;

  const safeA = Math.min(1, Math.max(0, a));

  return 2 * earthRadiusMeters *
    Math.atan2(Math.sqrt(safeA), Math.sqrt(1 - safeA));
}

function validateCoordinates(latitude, longitude) {
  return (
    typeof latitude === "number" &&
    typeof longitude === "number" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function isWithinOutletRadius(employeeLocation, outlet) {
  if (
    !validateCoordinates(employeeLocation.latitude, employeeLocation.longitude) ||
    !validateCoordinates(outlet.latitude, outlet.longitude)
  ) {
    return false;
  }

  const configuredRadius = Number.isInteger(outlet.radiusMeters)
    ? outlet.radiusMeters
    : 100;

  const radius = Math.min(100, Math.max(1, configuredRadius));

  const distanceMeters = calculateDistanceMeters(
    employeeLocation.latitude,
    employeeLocation.longitude,
    outlet.latitude,
    outlet.longitude
  );

  return {
    allowed: distanceMeters <= radius,
    distanceMeters: Math.round(distanceMeters),
    radiusMeters: radius
  };
}

module.exports = {
  calculateDistanceMeters,
  validateCoordinates,
  isWithinOutletRadius
};
