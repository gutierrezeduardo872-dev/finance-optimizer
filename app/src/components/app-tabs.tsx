import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useColorScheme } from 'react-native';

import { T } from '@/norte/theme';

export default function AppTabs() {
  useColorScheme(); // Norte es oscuro siempre; el hook queda por si eso cambia.

  return (
    <NativeTabs
      backgroundColor={T.surface2}
      indicatorColor={T.copperSoft}
      labelStyle={{ selected: { color: T.copper } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Inicio</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/home.png')}
          renderingMode="template"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="tarjeta">
        <NativeTabs.Trigger.Label>Tarjeta</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/explore.png')}
          renderingMode="template"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="ahorro">
        <NativeTabs.Trigger.Label>Ahorro</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/explore.png')}
          renderingMode="template"
        />
      </NativeTabs.Trigger>

      {/* Los tres iconos son los dos de la plantilla, repetidos. Cosmético y
          pendiente: no vale gastar una sesión de depuración en esto ahora. */}
      <NativeTabs.Trigger name="productos">
        <NativeTabs.Trigger.Label>Productos</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/home.png')}
          renderingMode="template"
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
