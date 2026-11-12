/** 未设置群名时按服务端前九位成员顺序拼接昵称，省略由显示容器处理。 */
export const formatGroupDisplayName = (
  name: string,
  memberNames: readonly (string | null | undefined)[],
): string => {
  if (name.trim()) return name;
  return (
    memberNames
      .slice(0, 9)
      .map((memberName) => memberName?.trim() ?? '')
      .filter(Boolean)
      .join(',') || '群聊'
  );
};

/** 显示名称与原始群名分开，编辑群名时仍使用服务端原值。 */
export const groupDisplayName = (group: {
  name: string;
  displayName?: string;
}): string => {
  if (group.name.trim()) return group.name;
  return group.displayName || '群聊';
};
