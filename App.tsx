import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { initDB } from './src/db/database';
import TranslatorScreen from './src/screens/TranslatorScreen';
import KintaroScreen from './src/screens/KintaroScreen';
import DeckScreen from './src/screens/DeckScreen';

const Tab = createBottomTabNavigator();

export default function App() {
  const [dbReady, setDbReady] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);

  useEffect(() => {
    initDB()
      .then(() => setDbReady(true))
      .catch((e) => setDbError(String(e)));
  }, []);

  if (dbError) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Failed to open database:{'\n'}{dbError}</Text>
      </View>
    );
  }

  if (!dbReady) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#4A90D9" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <StatusBar style="dark" />
      <Tab.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: '#F5F8FF' },
          headerTitleStyle: { fontWeight: '700', color: '#2C3E50' },
          tabBarActiveTintColor: '#4A90D9',
          tabBarInactiveTintColor: '#A0ADB5',
          tabBarStyle: { backgroundColor: '#fff', borderTopColor: '#E8ECF0' },
        }}
      >
        <Tab.Screen
          name="Translator"
          component={TranslatorScreen}
          options={{ tabBarLabel: 'Translate', title: 'Translator' }}
        />
        <Tab.Screen
          name="Kintaro"
          component={KintaroScreen}
          options={{ tabBarLabel: 'Kintaro', title: 'Kintaro' }}
        />
        <Tab.Screen
          name="Deck"
          component={DeckScreen}
          options={{ tabBarLabel: 'Deck', title: 'My Deck' }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F5F8FF',
  },
  errorText: {
    color: '#E74C3C',
    fontSize: 15,
    textAlign: 'center',
    padding: 24,
  },
});
