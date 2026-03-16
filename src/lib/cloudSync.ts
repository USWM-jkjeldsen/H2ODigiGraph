import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import type { DigiPoint, DigiSession, Site } from './types';
import { getFirebaseDb, getFirebaseStorageInstance, isFirebaseConfigured } from './firebase';

function pruneUndefined<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined)) as T;
}

function getImageExtension(uri: string): string {
  const cleanUri = uri.split('?')[0];
  const match = cleanUri.match(/\.([a-zA-Z0-9]+)$/);
  return match?.[1]?.toLowerCase() ?? 'jpg';
}

async function uploadImageIfNeeded(
  uri: string | undefined,
  existingUrl: string | undefined,
  existingPath: string | undefined,
  fallbackPath: string,
): Promise<{ path: string; url: string } | null> {
  if (!uri) return null;
  if (existingUrl && existingPath) {
    return { path: existingPath, url: existingUrl };
  }

  const storage = getFirebaseStorageInstance();
  if (!storage) {
    return null;
  }

  const response = await fetch(uri);
  const blob = await response.blob();
  const imagePath = existingPath ?? `${fallbackPath}.${getImageExtension(uri)}`;

  const storageRef = ref(storage, imagePath);
  await uploadBytes(storageRef, blob, { contentType: blob.type || 'image/jpeg' });
  const downloadUrl = await getDownloadURL(storageRef);

  return {
    path: imagePath,
    url: downloadUrl,
  };
}

async function uploadSessionImages(
  session: DigiSession,
): Promise<
  Pick<DigiSession, 'cloudImagePath' | 'cloudImageUrl' | 'cloudCroppedImagePath' | 'cloudCroppedImageUrl'>
> {
  const chartImage = await uploadImageIfNeeded(
    session.imageUri,
    session.cloudImageUrl,
    session.cloudImagePath,
    `sites/${session.siteId}/sessions/${session.id}/chart`,
  );

  const croppedImage = await uploadImageIfNeeded(
    session.croppedImageUri,
    session.cloudCroppedImageUrl,
    session.cloudCroppedImagePath,
    `sites/${session.siteId}/sessions/${session.id}/chart-cropped`,
  );

  return {
    cloudImagePath: chartImage?.path,
    cloudImageUrl: chartImage?.url,
    cloudCroppedImagePath: croppedImage?.path,
    cloudCroppedImageUrl: croppedImage?.url,
  };
}

async function replaceSessionPoints(sessionId: string, points: DigiPoint[] | undefined): Promise<void> {
  const db = getFirebaseDb();
  if (!db) {
    return;
  }

  const pointsCollectionRef = collection(db, 'sessions', sessionId, 'points');
  const existing = await getDocs(pointsCollectionRef);
  const deleteBatch = writeBatch(db);
  existing.docs.forEach((pointDoc) => {
    deleteBatch.delete(pointDoc.ref);
  });
  await deleteBatch.commit();

  if (!points || points.length === 0) {
    return;
  }

  const addBatch = writeBatch(db);
  points.forEach((point, idx) => {
    const pointRef = doc(pointsCollectionRef, String(idx + 1).padStart(4, '0'));
    addBatch.set(pointRef, {
      order: idx,
      px: point.px,
      realX: point.realX,
      realY: point.realY,
    });
  });
  await addBatch.commit();
}

function toIsoOrNow(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  return new Date().toISOString();
}

export async function syncSiteToCloud(site: Site): Promise<void> {
  if (!isFirebaseConfigured()) {
    return;
  }

  const db = getFirebaseDb();
  if (!db) {
    return;
  }

  await setDoc(
    doc(db, 'sites', site.id),
    {
      ...pruneUndefined({
        id: site.id,
        name: site.name,
        siteCode: site.siteCode,
        description: site.description,
        latitude: site.latitude,
        longitude: site.longitude,
        createdAt: site.createdAt,
      }),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function deleteSiteFromCloud(siteId: string): Promise<void> {
  if (!isFirebaseConfigured()) {
    return;
  }

  const db = getFirebaseDb();
  if (!db) {
    return;
  }

  await deleteDoc(doc(db, 'sites', siteId));
}

export async function syncSessionToCloud(
  session: DigiSession,
): Promise<Partial<DigiSession> | null> {
  if (!isFirebaseConfigured()) {
    return null;
  }

  const db = getFirebaseDb();
  if (!db) {
    return null;
  }

  const imagePatch = await uploadSessionImages(session);
  const mergedSession = { ...session, ...imagePatch };

  await setDoc(
    doc(db, 'sessions', session.id),
    {
      ...pruneUndefined({
        id: mergedSession.id,
        siteId: mergedSession.siteId,
        capturedAt: mergedSession.capturedAt,
        captureSource: mergedSession.captureSource,
        captureLocation: mergedSession.captureLocation,
        status: mergedSession.status,
        bounds: mergedSession.bounds,
        extractedLinePx: mergedSession.extractedLinePx,
        exportedAt: mergedSession.exportedAt,
        imageUrl: mergedSession.cloudImageUrl,
        imagePath: mergedSession.cloudImagePath,
        croppedImageUri: mergedSession.croppedImageUri,
        croppedImageUrl: mergedSession.cloudCroppedImageUrl,
        croppedImagePath: mergedSession.cloudCroppedImagePath,
      }),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );

  await replaceSessionPoints(session.id, mergedSession.points);

  return imagePatch;
}

export async function deleteSessionFromCloud(
  sessionId: string,
  cloudImagePath?: string,
  cloudCroppedImagePath?: string,
): Promise<void> {
  if (!isFirebaseConfigured()) {
    return;
  }

  const db = getFirebaseDb();
  const storage = getFirebaseStorageInstance();
  if (!db) {
    return;
  }

  await deleteDoc(doc(db, 'sessions', sessionId));

  if (storage && cloudImagePath) {
    await deleteObject(ref(storage, cloudImagePath));
  }

  if (storage && cloudCroppedImagePath) {
    await deleteObject(ref(storage, cloudCroppedImagePath));
  }
}

export async function fetchSitesFromCloud(): Promise<Site[] | null> {
  if (!isFirebaseConfigured()) {
    return null;
  }

  const db = getFirebaseDb();
  if (!db) {
    return null;
  }

  const snap = await getDocs(collection(db, 'sites'));
  return snap.docs.map((siteDoc) => {
    const data = siteDoc.data();
    return {
      id: siteDoc.id,
      name: String(data.name ?? ''),
      siteCode: String(data.siteCode ?? ''),
      description: typeof data.description === 'string' ? data.description : undefined,
      latitude: typeof data.latitude === 'number' ? data.latitude : undefined,
      longitude: typeof data.longitude === 'number' ? data.longitude : undefined,
      createdAt: toIsoOrNow(data.createdAt),
    } satisfies Site;
  });
}

async function fetchPointsForSession(sessionId: string): Promise<DigiPoint[]> {
  const db = getFirebaseDb();
  if (!db) {
    return [];
  }

  const pointQuery = query(
    collection(db, 'sessions', sessionId, 'points'),
    orderBy('order', 'asc'),
  );
  const snap = await getDocs(pointQuery);

  return snap.docs
    .map((pointDoc) => {
      const data = pointDoc.data();
      if (
        typeof data.realX !== 'number' ||
        typeof data.realY !== 'number' ||
        !data.px ||
        typeof data.px.x !== 'number' ||
        typeof data.px.y !== 'number'
      ) {
        return null;
      }

      return {
        px: { x: data.px.x, y: data.px.y },
        realX: data.realX,
        realY: data.realY,
      } satisfies DigiPoint;
    })
    .filter((point): point is DigiPoint => point !== null);
}

export async function fetchSessionsFromCloud(): Promise<DigiSession[] | null> {
  if (!isFirebaseConfigured()) {
    return null;
  }

  const db = getFirebaseDb();
  if (!db) {
    return null;
  }

  const snap = await getDocs(collection(db, 'sessions'));
  const sessions: DigiSession[] = [];

  for (const sessionDoc of snap.docs) {
    const data = sessionDoc.data();
    const points = await fetchPointsForSession(sessionDoc.id);
    const imageUriCandidate =
      typeof data.imageUrl === 'string'
        ? data.imageUrl
        : typeof data.imageUri === 'string'
          ? data.imageUri
          : '';

    if (!imageUriCandidate) {
      continue;
    }

    sessions.push({
      id: sessionDoc.id,
      siteId: String(data.siteId ?? ''),
      imageUri: imageUriCandidate,
      capturedAt: toIsoOrNow(data.capturedAt),
      captureSource:
        data.captureSource === 'camera' ||
        data.captureSource === 'library' ||
        data.captureSource === 'web-upload'
          ? data.captureSource
          : undefined,
      captureLocation:
        data.captureLocation &&
        typeof data.captureLocation.latitude === 'number' &&
        typeof data.captureLocation.longitude === 'number'
          ? {
              latitude: data.captureLocation.latitude,
              longitude: data.captureLocation.longitude,
              accuracy:
                typeof data.captureLocation.accuracy === 'number'
                  ? data.captureLocation.accuracy
                  : null,
              altitude:
                typeof data.captureLocation.altitude === 'number'
                  ? data.captureLocation.altitude
                  : null,
              heading:
                typeof data.captureLocation.heading === 'number'
                  ? data.captureLocation.heading
                  : null,
              speed:
                typeof data.captureLocation.speed === 'number' ? data.captureLocation.speed : null,
              capturedAt: toIsoOrNow(data.captureLocation.capturedAt),
            }
          : undefined,
      status:
        data.status === 'captured' ||
        data.status === 'bounded' ||
        data.status === 'digitized' ||
        data.status === 'exported'
          ? data.status
          : 'captured',
      bounds: data.bounds,
      points,
      extractedLinePx:
        Array.isArray(data.extractedLinePx)
          ? data.extractedLinePx
              .filter((p) => p && typeof p.x === 'number' && typeof p.y === 'number')
              .map((p) => ({ x: p.x, y: p.y }))
          : undefined,
      exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : undefined,
      croppedImageUri:
        typeof data.croppedImageUri === 'string'
          ? data.croppedImageUri
          : typeof data.croppedImageUrl === 'string'
            ? data.croppedImageUrl
            : undefined,
      cloudImagePath: typeof data.imagePath === 'string' ? data.imagePath : undefined,
      cloudImageUrl: typeof data.imageUrl === 'string' ? data.imageUrl : undefined,
      cloudCroppedImagePath:
        typeof data.croppedImagePath === 'string' ? data.croppedImagePath : undefined,
      cloudCroppedImageUrl:
        typeof data.croppedImageUrl === 'string' ? data.croppedImageUrl : undefined,
    });
  }

  return sessions;
}
