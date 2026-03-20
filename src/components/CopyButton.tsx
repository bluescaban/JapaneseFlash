import React, { useState } from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import * as Clipboard from 'expo-clipboard';

interface Props {
  text: string;
  style?: object;
}

export default function CopyButton({ text, style }: Props) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await Clipboard.setStringAsync(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <TouchableOpacity
      style={[styles.button, copied && styles.buttonCopied, style]}
      onPress={handleCopy}
      activeOpacity={0.7}
    >
      <Text style={[styles.label, copied && styles.labelCopied]}>
        {copied ? 'Copied!' : 'Copy'}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#F0F4F8',
    borderWidth: 1,
    borderColor: '#D5DDE6',
  },
  buttonCopied: {
    backgroundColor: '#E8F8EF',
    borderColor: '#A8DBBF',
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#7F8C8D',
  },
  labelCopied: {
    color: '#27AE60',
  },
});
