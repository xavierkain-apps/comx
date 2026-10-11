// GPS position of this phone, shared with the channel. Works with the phone in
// a pouch: we never rely on its compass, only on GPS course and speed.

import Geolocation, {GeolocationResponse} from '@react-native-community/geolocation';
import {PermissionsAndroid, Platform} from 'react-native';
import {Position} from '../ride/protocol';
import {appLog} from '../utils/logger';

/** Below this speed the GPS course is noise. 1 m/s ≈ 2 knots. */
const MIN_SPEED_FOR_COURSE = 1;

let configured = false;

function configure() {
  if (configured) return;
  configured = true;
  Geolocation.setRNConfiguration({
    skipPermissionRequests: true,
    authorizationLevel: 'whenInUse',
    enableBackgroundLocationUpdates: true,
    locationProvider: 'auto',
  });
}

export async function requestLocationPermission(): Promise<boolean> {
  configure();
  if (Platform.OS === 'android') {
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
    return result === PermissionsAndroid.RESULTS.GRANTED;
  }
  return new Promise(resolve => {
    Geolocation.requestAuthorization(
      () => resolve(true),
      err => {
        appLog('Location', `authorization refused: ${err.message}`);
        resolve(false);
      },
    );
  });
}

export function toPosition(r: GeolocationResponse): Position {
  const {latitude, longitude, accuracy, heading, speed} = r.coords;
  const sog = speed !== null && speed !== undefined && speed >= 0 ? speed : null;
  const cog =
    sog !== null && sog >= MIN_SPEED_FOR_COURSE && heading !== null && heading !== undefined && heading >= 0
      ? heading
      : null;
  return {lat: latitude, lon: longitude, cog, sog, acc: accuracy ?? 0, t: r.timestamp || Date.now()};
}

/** Start GPS updates. Returns a stop function. */
export function watchPosition(onPosition: (p: Position) => void): () => void {
  configure();
  const id = Geolocation.watchPosition(
    r => onPosition(toPosition(r)),
    err => appLog('Location', `watch error ${err.code}: ${err.message}`),
    {enableHighAccuracy: true, distanceFilter: 0, interval: 2000, fastestInterval: 1000, maximumAge: 5000},
  );
  return () => Geolocation.clearWatch(id);
}
