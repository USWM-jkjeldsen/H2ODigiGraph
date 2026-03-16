import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Colors } from '../src/lib/theme';
import { SyncStatusPill } from '../src/components/SyncStatusPill';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: Colors.primary },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '700' },
          headerRight: () => <SyncStatusPill />,
          contentStyle: { backgroundColor: Colors.background },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'H2oDigiGraph — Sites' }} />
        <Stack.Screen name="site/[id]" options={{ title: 'Site Detail' }} />
        <Stack.Screen
          name="capture"
          options={{ title: 'Capture Chart', presentation: 'modal' }}
        />
        <Stack.Screen name="digitize/[sessionId]" options={{ title: 'Digitize Chart' }} />
        <Stack.Screen
          name="export/[sessionId]"
          options={{ title: 'Export CSV', presentation: 'modal' }}
        />
        <Stack.Screen
          name="site/new"
          options={{ title: 'Add Site', presentation: 'modal' }}
        />
      </Stack>
    </>
  );
}
