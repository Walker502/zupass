import { InputHTMLAttributes, Ref } from "react";
import styled from "styled-components";

export const BigInput = styled.input`
  width: 100%;
  height: 46px;
  border-radius: 46px;
  padding: 12px;
  font-size: 16px;
  font-weight: 300;
  border: 1px solid rgba(var(--white-rgb), 0.3);
  background: transparent;
  background: rgba(0, 0, 0, 0.2);
  color: #fff;
  text-align: center;

  &::placeholder {
    color: rgba(var(--white-rgb), 0.4);
  }

  &:disabled {
    user-select: none;
    pointer-events: none;
    background: rgba(0, 0, 0, 0.05);
  }
`;

interface EmailCodeInputProps extends InputHTMLAttributes<HTMLInputElement> {
  ref?: Ref<HTMLInputElement>;
}

export const EmailCodeInput = (inputProps: EmailCodeInputProps) => {
  return <BigInputWithoutArrows {...inputProps} type="number" />;
};

// Removes the up and down arrows for type="number" inputs.
// Source: https://www.w3schools.com/howto/howto_css_hide_arrow_number.asp
const BigInputWithoutArrows = styled(BigInput)`
  &::-webkit-outer-spin-button,
  &::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  /* Firefox */
  -moz-appearance: textfield;
  appearance: none;
`;
